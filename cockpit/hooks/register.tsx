
import type { Register } from 'claude-code'

import type { Changed, Ph } from '../types'
import { ACTS, act } from './acts'
import { runCockpitCommand } from './commands'
import { set, look, loadPrefs, applyOptions, openPane, paneShown, readTermBg } from './core/core'
import { loadHistory, saveHistory } from './core/history'
import { measure } from './core/session'
import { syncAgents, registerExperts, discoverAgentTypes, isHandoff, takeHandoff, isOwnStart, agentSpawned, agentToolCall, agentToolDone, agentTurnEnd } from './agents/agents'
import { expertName } from './agents/experts'
import { drawings } from './chat/drawings'
import { writeSteps, trackPlan } from './flows/flows-io'
import { toOp, isEditTool } from './flows/tools'
import { changesOf, openFlow, dropFlow, resumeFlow, toolStarted, toolFailed, toolDone, mainTurnEnd } from './flows/turn-io'
import { loadAccounts } from './git/accounts'
import { refreshRepo, loadGitPrefs } from './git/git'
import { livePr } from './git/pr'
import { snapTurn } from './git/turns-io'
import { nextStep } from './judges/autopilot'
import { setJudgeModels } from './judges/judges'
import { personSpoke, judgeQuestions, personAnswered } from './judges/decisions'
import { loadGuide } from './memory/explain'
import { memoryText, recall, memoryKey } from './memory/memory'
import { buildMemory, loadProject, syncMemory } from './memory/memory-io'
import { fullPane } from './pane/full-pane'

// The hooks module: every hook Cockpit registers, in the order the engine runs them for one event. Each hook keeps
// its `next` here; the work around it lives with its feature (commands.ts, core/, flows/, agents/, judges/, git/, memory/)
export const register: Register = (on, options) => {
  setJudgeModels(options.judgeModels)
  // Root of the session's working directory, for relative paths
  let root = ''
  // The live-figure timers, so a second session.start (an enable) replaces them rather than doubling them
  let timers: { cancel: () => void }[] = []

  // Whether the running main turn wrote or edited a file (auto-test and auto-commit read it)
  let changedThisTurn = false
  // The repository's changes when the prompt was sent, to tell at the turn's end whether it changed files
  // null until a prompt records it (a reload starts over), so a reload never commits what no turn of its changed
  let changesAtStart: string | null = null
  // Each changed file's lines when the turn started, so changes a shell command made count in the flow's +/−
  let linesAtStart: Changed[] = []
  // Prompts typed over a running turn: each opens its flow when a turn of its own starts with it
  const queued = new Set<string>()
  // The last prompt was a command or the engine's own: the turn it starts carries on the last flow
  let carryOn = false
  // The flow the running main turn belongs to, for its after-snapshot
  let turnFlow = ''
  // The same by the turn's id, so a turn's end finds its own flow even when the next turn started first
  const turnFlows = new Map<string, string>()
  // A turn begins: nothing of its own changed yet, and the repository as its flow's opening read it is what its end
  // compares with
  const beginTurn = async <F extends { changes: Changed[] }>(opening: Promise<F>) => {
    changedThisTurn = false
    const flow = await opening
    linesAtStart = flow.changes
    changesAtStart = changesOf(flow.changes)
    return flow
  }

  // Agents finished while others of theirs still ran, for the one notice when the last is done
  const batch = new Set<string>()

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    root = await $.session.cwd()
    // The command and the timers first: a load below that fails must not leave /cockpit unregistered
    await $.command.register({
      name: 'cockpit',
      description: 'Open the Cockpit pane; or: task|autopilot [$budget] [hours h] <goal> (stop, resume), product [$budget] [hours h] <vision> (stop, resume), focus [on|off], explain (Claude writes a codebase guide), theme <auto|paper|white|black|solarized|nord>, mode <auto|ask|off>, tab <overview|files|agents|git|rules>, flow <plan|task|build|docs|check|answer>, run <agents> [-- task], test',
      argumentHint: '[task [$budget] [hours h] <goal> | product [$budget] [hours h] <vision> | explain | focus [on|off] | theme <name> | mode <auto|ask|off> | tab <name> | flow <name> | run <agents> [-- task] | test]',
    })
    for (const t of timers) t.cancel()
    timers = []
    // Background work does not outlive a load of the mod (its promises went with the old module): its names go too
    await set($, { busy: {} })
    // Live figures: a redraw a few times a second while anything runs; the repo and usage read again every 15 s while the pane is shown
    timers.push($.clock.every(400, async () => {
      const s = await look($)
      const busy = s.isWorking || s.waiting !== '' || s.agents.some(a => a.status === 'running')
      if (busy) $.ui.invalidate('ui.render')
    }))
    // Claude's subagents, from the engine's own list: seen even where Cockpit's hooks are not
    timers.push($.clock.every(2000, async () => {
      const s = await look($)
      if (s.isWorking || s.agents.some(a => a.status === 'running') || (await paneShown($))) await syncAgents($)
    }))
    timers.push($.clock.every(15000, async () => {
      // The terminal's background, so Auto switches when the terminal does
      if ((await look($)).theme === 'auto') await readTermBg($).catch(() => null)
      if (await paneShown($)) {
        // Each reading by itself: one that fails must not skip the rest of the tick
        await refreshRepo($).catch(() => null)
        // The branch's PR while a check is pending: green or red by itself, and a notice when the run finishes
        await livePr($).catch(() => null)
        await measure($).catch(() => null)
        await loadGuide($).catch(() => null)
        // The accounts too while their box is on screen (the Git tab's setup, or its options open): a gh login added
        // or a token that stopped working shows by itself
        const s = await look($)
        if (s.tab === 'git' && (s.ui.more || !s.git.setupDone)) await loadAccounts($).catch(() => null)
        // The Activity tab's file list, while it is the tab on screen
        if (s.tab === 'files') await loadProject($).catch(() => null)
      }
    }))
    await loadPrefs($)
    // What the install screen or /config chose, over the saved settings where it changed
    await applyOptions($, options).catch(() => null)
    await readTermBg($).catch(() => null)
    await loadHistory($)
    void buildMemory($).catch(() => null)
    void loadGuide($).catch(() => null)
    await refreshRepo($)
    await loadGitPrefs($)
    await loadAccounts($)
    await measure($)
    void registerExperts($)
    void discoverAgentTypes($)
    // Focus keeps the pane closed until /cockpit asks for it
    if ((await look($)).focus === false) void openPane($)
    return r
  })

  // A sub-command that fails answers so, rather than failing the command
  on('command.run', { command: 'cockpit' }, async ($, e) => runCockpitCommand($, e.args)).catch(() => ({ text: 'Cockpit could not run that: try again, or /cockpit alone to open the pane.' }))

  on('prompt.submit', async ($, e, next) => {
    // Cockpit's own hand-off of an agent start is no task of yours: no flow, no steps (turn.start drops the mark)
    if (isHandoff(e.text)) return next(e)
    // A command (/goal) or the engine's own message: the turn it starts carries on the last flow
    if (e.command || e.isMeta || !e.text.trim()) {
      carryOn = true
      return next(e)
    }
    const now = await $.clock.now()
    if (e.origin?.kind === 'composer') await personSpoke($, now)
    // Typed over a running turn: that turn and its flow go on; this one opens its own flow if a turn starts with it
    if (e.turnId) {
      const r = await next(e)
      if (!('drop' in r && r.drop)) queued.add((r.text ?? e.text).trim())
      return r
    }
    // Idle, so any prompt typed over an earlier turn has run or was read inside it
    queued.clear()
    const was = await look($)
    const flow = await beginTurn(openFlow($, e.text, now))
    // Files changed since the last turn (an editor, a checkout) join the memory, in the background so the prompt is not held
    void syncMemory($).catch(() => null)
    // What the prompt brings to mind goes beside it, so Claude checks those features first
    const m = was.memory
    const cue = Object.keys(m.files).length ? recall(m.files, m.features ?? [], m.facts ?? {}, e.text, was.ops.slice(-30).map(o => memoryKey(m.files, o.path)).filter(Boolean)) : ''
    const r = await next(cue ? { ...e, context: [...(e.context ?? []), cue] } : e)
    // Refused beneath (a settings hook's block, the engine's limit): no turn runs, so no flow either
    if ('drop' in r && r.drop) {
      changesAtStart = null
      await dropFlow($, flow.id, was)
      return r
    }
    // Its own steps, in the background so the prompt is not held
    void writeSteps($, flow.id, e.text.trim()).catch(() => null)
    return r
  }).catch(($, e, next) => next(e))

  // Every main turn runs in a flow. A prompt typed over a turn that the engine ran as a turn of its own opens its flow
  // now; so does a prompt another plugin's hook kept from Cockpit's prompt.submit. A turn with no prompt of yours (a
  // /goal carrying on, a background task's notice, a continuation) carries on the last flow, or opens the goal's flow
  // when /goal was set after it ended
  on('turn.start', async ($, e, next) => {
    if (e.agentId) return next(e)
    const text = e.text.trim()
    const carried = carryOn || !text
    carryOn = false
    if (takeHandoff(e.text)) return next(e)
    const now = await $.clock.now()
    const s = await look($)
    const last = s.flows[s.flows.length - 1]
    const fresh = async (task: string) => {
      const flow = await beginTurn(openFlow($, task, now))
      void writeSteps($, flow.id, task).catch(() => null)
    }
    if (text && queued.delete(text)) await fresh(text)
    else if (last?.status !== 'running') {
      const goalAfter = s.goal && (!last || s.goal.at > (last.endedAt ?? last.startedAt))
      if (goalAfter) await fresh(`Goal: ${s.goal!.text}`)
      else if (!carried) await fresh(text)
      else if (last) await beginTurn(resumeFlow($, now))
    }
    // The working tree as it is before Claude's first tool call, to undo this turn by; the flow is kept for its end,
    // which may run after the next turn has opened another
    turnFlow = (await look($)).flows.at(-1)?.id ?? ''
    if (e.turnId) {
      turnFlows.set(e.turnId, turnFlow)
      // A turn whose end never came leaves its entry: the oldest goes
      if (turnFlows.size > 20) turnFlows.delete(turnFlows.keys().next().value!)
    }
    await snapTurn($, turnFlow, 'before').catch(() => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The goal Claude works toward across turns: set by /goal or Claude's ProposeGoal, cleared by /goal clear
  on('command.run', { command: 'goal' }, async ($, e, next) => {
    const r = await next(e)
    const args = e.args.trim()
    if (args === 'clear') await set($, { goal: undefined })
    else if (args) await set($, { goal: { text: args, at: await $.clock.now() } })
    return r
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'ProposeGoal' }, async ($, e, next) => {
    const r = await next(e)
    const cond = 'result' in r ? (r.result as { condition?: unknown } | undefined)?.condition : undefined
    if (!e.agentId && !r.isError && typeof cond === 'string' && cond) await set($, { goal: { text: cond, at: await $.clock.now() } })
    return r
  }).catch(($, e, next) => next(e))

  // Every tool call: subagent calls go to that agent's log; main-loop calls drive activity, steps and the file list
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const now = await $.clock.now()
    const op = toOp(e.tool, input, e.tool_use_id ?? `op${now}`, now)
    if (e.agentId) {
      await agentToolCall($, e.agentId, e.tool, input, now)
      const r = await next(e)
      if (!r.deny && !r.isError) await agentToolDone($, e.tool, input, op)
      return r
    }
    await toolStarted($, e.tool, input, op)
    const r = await next(e)
    // A refused or failed edit changed nothing: no tests, no commit, no re-read for it
    if (r.deny || r.isError) {
      await toolFailed($, e.tool, r.deny, r.result, now)
      return r
    }
    // Set before anything awaits, so a failure below does not lose it
    if (isEditTool(e.tool) || op?.op === 'Delete') changedThisTurn = true
    await toolDone($, e.tool, op)
    return r
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const m = (await look($)).memory
    if (!Object.keys(m.files).length) return r
    return { ...r, sections: [...r.sections, { id: 'cockpit:memory', text: memoryText(m.files, 2600, m.features), scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  // Claude's own task list: while it keeps one, the current flow's steps are its tasks, live
  on('tool.call', { tool: ['TodoWrite', 'TaskCreate', 'TaskUpdate'] }, async ($, e, next) => {
    const r = await next(e)
    await trackPlan($, e, r)
    return r
  }).catch(($, e, next) => next(e))
  // This app's own task list, and the wrap-up that ticks it off. The matcher is cast loose: the generated
  // types know only the MCP tools connected when they were written, so the literals alone fail tsc in other sessions
  on('tool.call', { tool: ['mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up'] } as {}, async ($, e, next) => {
    const r = await next(e)
    await trackPlan($, e, r)
    // The wrap-up's question goes to the judges, in the background: the turn ends as it would
    if ((e.tool as string) === 'mcp__ccd_turn__wrap_up' && !e.agentId) void nextStep($, e as unknown as Record<string, unknown>).catch(() => null)
    return r
  }).catch(($, e, next) => next(e))

  // Claude's questions: judges vote in auto mode, the person answers in ask mode or on a split
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId) return next(e)
    const put = await judgeQuestions($, e.questions, e.tool_use_id)
    if (put.answers) return { result: { questions: e.questions, answers: put.answers } }
    const r = await next(e)
    await personAnswered($, put.ids, ('result' in r && r.result ? (r.result as { answers?: Record<string, string> }).answers : undefined) ?? {})
    return r
  }).catch(($, e, next) => next(e))

  // A subagent started from the pane: where the engine would hand it to the mode's decider (auto mode's classifier,
  // which judges a spawn by a model request and has none for a press), it is put to the person in the permission
  // dialog instead. A rule or mode that allows it, or one that denies it, stands; every other Agent call is untouched
  on('tool.check', { tool: 'Agent' }, async ($, e, next) => {
    const v = await next(e)
    if (v.decision !== 'ask' || !isOwnStart(e.input)) return v
    const i = (e.input ?? {}) as Record<string, unknown>
    return { decision: 'ask', reason: `Cockpit pane: you asked it to start the ${expertName(String(i.subagent_type ?? 'general-purpose'))} agent` }
  }).catch(($, e, next) => next(e))

  // Subagents the model or anyone else starts show in the Agents tab
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if ('agentId' in r && r.agentId) await agentSpawned($, r.agentId, e)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // This turn's figures, taken before anything awaits: the next turn may start while this hook still runs, and a
    // failure below must not carry them into it
    const own = e.agentId ? undefined : turnFlows.get(e.turnId)
    const turn = { changed: changedThisTurn, atStart: changesAtStart, linesWere: linesAtStart, flow: own ?? turnFlow }
    if (!e.agentId) {
      changedThisTurn = false
      changesAtStart = null
      turnFlows.delete(e.turnId)
      // A turn with no start of its own here (a hand-off's) must not end the flow of an earlier one; a next turn that
      // started first keeps its own
      if (own === undefined || own === turnFlow) turnFlow = ''
    }
    const r = await next(e)
    if (e.agentId) await agentTurnEnd($, e.agentId, e.answer, e.isAborted, e.reason === 'error', batch)
    else await mainTurnEnd($, e, turn)
    return r
  }).catch(async ($, e, next) => {
    // Whatever failed, the main turn is over: the band and the timers must not think it still runs
    if (!e.agentId) await set($, { isWorking: false, waiting: '' }).catch(() => null)
    return next(e)
  })

  // A session that ends keeps its spend: the figures measured once more and the history saved
  on('session.end', async ($, e, next) => {
    await measure($).catch(() => null)
    await saveHistory($).catch(() => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await measure($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // What another plugin hooking Cockpit calls: they read the state and change it through these, answered here (the
  // state itself is written in core/core.ts); `act` runs an action of ./acts by name, its result handed back as plain data
  on('engine.create', async (_$, e, next) => ({ ...(await next(e)), cockpit: { set: async () => true, act: async () => null, tab: async () => true } }))
  on('cockpit.set', async ($, e) => {
    await set($, e.patch as Partial<Ph>)
    return { value: true }
  }).catch(() => ({ deny: 'Cockpit could not change its state' }))
  on('cockpit.act', async ($, e) => {
    if (!(ACTS as readonly string[]).includes(e.name)) return { deny: `Cockpit has no action ${e.name}` }
    const r = await act($, e.name, e.args)
    return { value: r === undefined ? null : JSON.parse(JSON.stringify(r)) }
  }).catch((_$, e) => ({ deny: `Cockpit's action ${e.name} failed` }))
  // An add-on says which tab it draws; the pane shows only those, and opens on one of them
  on('cockpit.tab', async ($, e) => {
    await set($, st => {
      const tabs = [...new Set([...(st.tabsAvailable ?? []), e.id])]
      return { tabsAvailable: tabs, tab: tabs.includes(st.tab) ? st.tab : (tabs[0] ?? st.tab) }
    })
    return { value: true }
  }).catch(() => ({ deny: 'Cockpit could not add the tab' }))
  drawings(on)
  fullPane(on, () => root)
}
