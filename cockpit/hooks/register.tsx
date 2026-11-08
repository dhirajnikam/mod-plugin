import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Changed, Decision, Ph, Tab, ThemeId } from '../types'
import {
  advancePipeline,
  commit,
  decideCommit,
  discoverAgentTypes,
  finishAgent,
  testAgent,
  TESTERS,
  changedFiles,
  isOwnStart,
  syncAgents,
  runMany,
  handoffs,
  earlyPlans,
  startAutopilot,
  stopAutopilot,
  loadRules,
  resumeAutopilot,
  autopilotTurnEnd,
  judgeNext,
  personSpoke,
  RISKY,
  PERSONAL,
  OPEN,
  loadPrefs,
  loadHistory,
  writeSteps,
  buildMemory,
  updateMemory,
  repoRoot as repoRootOf,
  saveHistory,
  judge,
  loadAccounts,
  loadGitPrefs,
  measure,
  loadProject,
  openPane,
  pickFlow,
  refreshRepo,
  livePr,
  snapTurn,
  measureWorktree,
  tellDone,
  checkBudget,
  plainType,
  toast,
  refreshGit,
  registerExperts,
  set,
  startPipeline,
  followEdit,
  setTheme,
  trackAgent,
} from './actions'
import { ACTS, act } from './acts'
import { EXPERTS, FLOWS, activityOf, applyPlan, expertName, flowOf, progress, selfCheck, stepOf, toOp, verifyState } from './logic'
import { memoryText } from './memory'
import { withCurrent } from './spend'
import { INITIAL, PANE } from './state'
import { THEME_IDS } from './theme'
import { drawings } from './drawings'
import { fullPane } from './full-pane'

// The session's Cockpit state (see state.ts)
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-24' })

const TABS: Tab[] = ['overview', 'files', 'agents', 'git', 'rules']

export const register: Register = on => {
  // Root of the session's working directory, for relative paths
  let root = ''
  // Whether the running turn wrote or edited a file (auto-test and auto-commit read it)
  let changedThisTurn = false
  // The repository's changes when the prompt was sent: a turn changed files when they differ at its end, however it
  // edited them (Edit and Write, a shell command, a script, a formatter)
  // null until a prompt records it (a reload starts over), so a reload never commits what no turn of its changed
  let changesAtStart: string | null = null
  const changesOf = (c: { path: string; meta: string }[]) => c.map(x => `${x.path} ${x.meta}`).join('\n')
  // Each changed file's lines when the turn started, so changes a shell command made count in the flow's +/−
  let linesAtStart: Changed[] = []
  const atStartOf = (c: Changed[]) => ((linesAtStart = c), changesOf(c))
  // Prompts typed over a running turn: each opens its flow when a turn of its own starts with it
  const queued = new Set<string>()
  // The last prompt was a command or the engine's own: the turn it starts carries on the last flow
  let carryOn = false
  // The live-figure timers, so a second session.start (an enable) replaces them rather than doubling them
  let timers: { cancel: () => void }[] = []
  // The flow the running main turn belongs to, for its after-snapshot
  let turnFlow = ''
  // Agents finished while others of theirs still ran, for the one notice when the last is done
  const batch = new Map<string, number>()
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    root = await $.session.cwd()
    // The command and the timers first: a load below that fails must not leave /cockpit unregistered
    await $.command.register({
      name: 'cockpit',
      description: 'Open the Cockpit pane; or: task|autopilot [$budget] [hours h] <goal> (stop, resume), product [$budget] [hours h] <vision> (stop, resume), focus [on|off], theme <auto|paper|white|black|solarized|nord>, mode <auto|ask|off>, tab <overview|files|agents|git|rules>, flow <plan|task|build|docs|check|answer>, run <agents> [-- task], test',
      argumentHint: '[task [$budget] [hours h] <goal> | product [$budget] [hours h] <vision> | focus [on|off] | theme <name> | mode <auto|ask|off> | tab <name> | flow <name> | run <agents> [-- task] | test]',
    })
    for (const t of timers) t.cancel()
    timers = []
    // Background work does not outlive a load of the mod (its promises went with the old module): its names go too
    await set($, { busy: {} })
    // Live figures: a redraw a few times a second while anything runs; the repo and usage read again every 15 s while the pane is shown
    timers.push($.clock.every(400, async () => {
      const s = await read($, S)
      const busy = s.isWorking || s.waiting !== '' || s.agents.some(a => a.status === 'running')
      if (busy) $.ui.invalidate('ui.render')
    }))
    // Claude's subagents, from the engine's own list: seen even where Cockpit's hooks are not
    timers.push($.clock.every(2000, async () => {
      const s = await read($, S)
      if (s.isWorking || s.agents.some(a => a.status === 'running') || (await $.ui.panes().catch(() => [])).some(p => p.id === PANE && p.isPlaced)) await syncAgents($)
    }))
    timers.push($.clock.every(15000, async () => {
      if ((await $.ui.panes().catch(() => [])).some(p => p.id === PANE && p.isPlaced)) {
        await refreshRepo($)
        // The branch's PR while a check is pending: green or red by itself, and a notice when the run finishes
        await livePr($).catch(() => null)
        await measure($)
        // The accounts too while their box is on screen (the Git tab's setup, or its options open): a gh login added
        // or a token that stopped working shows by itself
        const s = await read($, S)
        if (s.tab === 'git' && (s.ui.more || !s.git.setupDone)) await loadAccounts($).catch(() => null)
      }
    }))
    // Focus, theme and the rest: what draws next reads them
    await loadPrefs($)
    await loadHistory($)
    // The codebase memory, fresh each session, in the background
    void buildMemory($).catch(() => null)
    const bad = selfCheck()
    if (bad.length) $.ui.log(`cockpit self-check failed: ${JSON.stringify(bad)}`)
    await refreshRepo($)
    await loadGitPrefs($)
    await loadAccounts($)
    await measure($)
    void registerExperts($)
    void discoverAgentTypes($)
    // Focus keeps the pane closed until /cockpit asks for it
    if ((await read($, S)).focus === false) void openPane($)
    return r
  })

  on('command.run', { command: 'cockpit' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    // The autopilot's two roles: task (also `autopilot`) works on one goal until it is achieved; product leads the
    // product toward a vision, goal after goal, the judges choosing each
    if (verb === 'autopilot' || verb === 'task' || verb === 'product') {
      const product = verb === 'product'
      const name = product ? 'Product owner' : 'Autopilot'
      const rest = e.args.trim().split(/\s+/).slice(1)
      // stop and resume alone are commands ("task stop using jquery" is a goal), and act only on a run of this role
      if (rest.length === 1 && (rest[0] === 'stop' || rest[0] === 'resume')) {
        const ap = (await read($, S)).autopilot
        if (ap && (ap.role ?? 'task') !== (product ? 'product' : 'task')) return { text: `The run is ${ap.role === 'product' ? 'the product owner: /cockpit product' : 'a task: /cockpit task'} ${rest[0]}` }
        if (rest[0] === 'stop') return (await stopAutopilot($, 'stopped', 'you stopped it'), { text: `${name} stopped.` })
        return (await resumeAutopilot($), { text: `${name} resumed.` })
      }
      const budget = Number(rest.find(w => /^\$\d+(\.\d+)?$/.test(w))?.slice(1) ?? 0)
      const hours = Number(rest.find(w => /^\d+(\.\d+)?h$/.test(w))?.slice(0, -1) ?? 0)
      const goal = rest.filter(w => !/^\$\d+(\.\d+)?$/.test(w) && !/^\d+(\.\d+)?h$/.test(w)).join(' ').trim()
      if (!goal)
        return {
          text: product
            ? 'Usage: /cockpit product [$budget] [hours h] <vision>, e.g. /cockpit product $50 12h the fastest offline-first notes app. Each round it studies the product and its field, the judges pick the next goal, and the task builds it. /cockpit product stop · resume'
            : `Usage: /cockpit ${verb} [$budget] [hours h] <goal>, e.g. /cockpit ${verb} $20 4h add offline sync. Leave out the budget and hours to run until it is done. /cockpit ${verb} stop · resume`,
        }
      const no = await startAutopilot($, goal, budget, hours, product ? 'product' : 'task')
      if (no) return { text: no }
      await set($, { tab: 'overview' })
      await openPane($)
      return { text: `${name}: ${goal}${budget ? ` · $${budget}` : ' · no budget'}${hours ? ` · ${hours}h` : ''}` }
    }
    if (verb === 'theme') {
      if (!THEME_IDS.includes(arg as ThemeId)) return { text: `Themes: ${THEME_IDS.join(', ')}` }
      await setTheme($, arg as ThemeId)
      return { text: `Cockpit theme: ${arg}` }
    }
    if (verb === 'mode') {
      if (arg !== 'auto' && arg !== 'ask' && arg !== 'off') return { text: 'Modes: auto (the judges decide, and only advise on what is hard to undo), ask (they advise, you decide), off (no judges)' }
      await set($, { mode: arg })
      return { text: `Decisions: ${arg === 'auto' ? 'Auto · judge' : arg === 'ask' ? 'Ask me · the judges advise' : 'Judges off'}` }
    }
    if (verb === 'tab' && TABS.includes(arg as Tab)) await set($, { tab: arg as Tab })
    if (verb === 'tab' && arg === 'git') await refreshGit($)
    if (verb === 'tab' && arg === 'files') await loadProject($)
    if (verb === 'tab' && arg === 'rules') await loadRules($)
    if (verb === 'tab' && arg === 'agents') await Promise.all([discoverAgentTypes($), syncAgents($)])
    if (verb === 'focus') {
      const want = arg.toLowerCase()
      if (want && want !== 'on' && want !== 'off') return { text: 'Use /cockpit focus on, /cockpit focus off, or /cockpit focus to switch' }
      const isOn = want === 'on' ? true : want === 'off' ? false : (await read($, S)).focus === false
      await set($, { focus: isOn })
      return { text: `Focus ${isOn ? 'on: only your prompts, replies and progress show' : 'off'}` }
    }
    if (verb === 'flow') {
      const known = ['task', 'plan', ...FLOWS.map(x => x.name)].includes(arg.toLowerCase())
      if (known && !(await read($, S)).flows.length) return { text: 'No flow yet: send a prompt first.' }
      if (arg.toLowerCase() === 'task') {
        await pickFlow($, 'task')
        await openPane($)
        return { text: 'Task flow: the steps written for this task' }
      }
      if (arg.toLowerCase() === 'plan') {
        await pickFlow($, 'plan')
        await openPane($)
        return { text: "Plan flow: the steps are Claude's own task list" }
      }
      const f = FLOWS.find(x => x.name === arg.toLowerCase())
      if (!f) return { text: `Flows: ${FLOWS.map(x => `${x.name} (${x.steps.join(' › ')})`).join(', ')}` }
      await pickFlow($, f.name)
      await openPane($)
      return { text: `${f.label} flow: ${f.steps.join(' › ')}` }
    }
    // /cockpit run planner reviewer -- review the login: those agents at once, each with that task (the current one without)
    if (verb === 'run') {
      // The first lone -- splits names from the task, which keeps any -- of its own; none given, there is no task
      const rest = e.args.trim().replace(/^run\b\s*/, '')
      const cut = rest.search(/(?:^|\s)--(?:\s|$)/)
      const names = cut < 0 ? rest : rest.slice(0, cut)
      const task = cut < 0 ? '' : rest.slice(cut).replace(/^\s*--/, '')
      const s = await read($, S)
      const known = [...EXPERTS.map(x => x.type), ...s.custom.map(c => c.type)]
      const types = names.split(/[\s,]+/).filter(Boolean).map(n => known.find(k => k === n || k === `cockpit:${n}` || expertName(k).toLowerCase() === n.toLowerCase()) ?? n)
      if (!types.length) return { text: `Name the agents: /cockpit run ${EXPERTS.slice(0, 2).map(x => x.name.toLowerCase()).join(' ')} -- the task` }
      await runMany($, types, task.trim())
      await set($, { tab: 'agents' })
      await openPane($)
      return { text: `Running ${types.map(expertName).join(', ')}${task.trim() ? ` on: ${task.trim()}` : ''}` }
    }
    if (verb === 'test') await startPipeline($, 'verify')
    await openPane($)
    return { text: 'Cockpit pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // Cockpit's own hand-off of an agent start is no task of yours: no flow, no steps (turn.start drops the mark)
    if (handoffs.has(e.text)) return next(e)
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
    const was = await read($, S)
    changedThisTurn = false
    changesAtStart = atStartOf(await openFlow($, e.text, now))
    const r = await next(e)
    // Refused beneath (a settings hook's block, the engine's limit): no turn runs, so no flow either
    if ('drop' in r && r.drop) {
      changesAtStart = null
      await set($, s => ({ task: was.task, turnStart: was.turnStart, isWorking: false, activity: was.activity, reached: was.reached, flows: s.flows.filter(f => f.id !== `f${now}`) }))
      return r
    }
    // Its own steps, in the background so the prompt is not held
    void writeSteps($, `f${now}`, e.text.trim()).catch(() => null)
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
    if (handoffs.delete(e.text)) return next(e)
    const now = await $.clock.now()
    const s = await read($, S)
    const last = s.flows[s.flows.length - 1]
    const fresh = (task: string) => {
      changedThisTurn = false
      return openFlow($, task, now).then(c => {
        changesAtStart = atStartOf(c)
        void writeSteps($, `f${now}`, task).catch(() => null)
      })
    }
    if (text && queued.delete(text)) await fresh(text)
    else if (last?.status !== 'running') {
      const goalAfter = s.goal && (!last || s.goal.at > (last.endedAt ?? last.startedAt))
      if (goalAfter) await fresh(`Goal: ${s.goal!.text}`)
      else if (!carried) await fresh(text)
      else if (last) {
        changedThisTurn = false
        changesAtStart = atStartOf(await resumeFlow($, now))
      }
    }
    // The working tree as it is before Claude's first tool call, to undo this turn by; the flow is kept for its end,
    // which may run after the next turn has opened another
    turnFlow = (await read($, S)).flows.at(-1)?.id ?? ''
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
    if (e.agentId) {
      const what = String(input.file_path ?? input.pattern ?? input.command ?? input.description ?? '').split('\n')[0]?.slice(0, 80) ?? ''
      await set($, s => ({ agents: s.agents.map(a => (a.id === e.agentId ? { ...a, tools: a.tools + 1, log: [...a.log, { at: now, t: `${e.tool} ${what}` }].slice(-40) } : a)) }))
      const r = await next(e)
      // The codebase memory follows every edit, an agent's too, and the running flow counts its lines
      if (!r.deny && !r.isError && /^(Edit|Write|NotebookEdit|MultiEdit)$/.test(e.tool)) {
        await updateMemory($, String(input.file_path ?? input.notebook_path ?? ''))
        const op = toOp(e.tool, input, e.tool_use_id ?? `op${now}`, now)
        if (op) await set($, s => ({ flows: s.flows.map((f, i) => (i === s.flows.length - 1 && f.status === 'running' ? { ...f, add: f.add + op.add, del: f.del + op.del } : f)) }))
      }
      return r
    }
    const op = toOp(e.tool, input, e.tool_use_id ?? `op${now}`, now)
    const step = stepOf(e.tool, input)
    await set($, s => ({
      activity: activityOf(e.tool, input),
      ...(op ? { ops: [...s.ops, op].slice(-200) } : {}),
      ...(step && !s.reached.includes(step) ? { reached: [...s.reached, step] } : {}),
      flows: s.flows.map((f, i) => (i === s.flows.length - 1 && f.status === 'running' ? { ...f, ops: f.ops + (op ? 1 : 0), add: f.add + (op?.add ?? 0), del: f.del + (op?.del ?? 0), reached: step && !f.reached.includes(step) ? [...f.reached, step] : f.reached } : f)),
    }))
    const r = await next(e)
    // A refused or failed edit changed nothing: no tests, no commit, no re-read for it
    if (r.deny || r.isError) {
      const out = r.deny ? `refused: ${r.deny}` : typeof r.result === 'string' ? r.result : JSON.stringify(r.result ?? '')
      await set($, { lastError: { tool: e.tool, text: out.trim().split('\n')[0]?.slice(0, 160) ?? '', at: now } })
      return r
    }
    if (op && (op.op === 'Write' || op.op === 'Edit' || op.op === 'Delete')) changedThisTurn = true
    if (op && (op.op === 'Write' || op.op === 'Edit')) await updateMemory($, op.path)
    if (/^(Edit|Write)$/.test(e.tool) && typeof input.file_path === 'string') await followEdit($, input.file_path).catch(() => null)
    return r
  }).catch(($, e, next) => next(e))

  // The codebase memory in Claude's system prompt: the features, their files and how they connect
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const m = (await read($, S)).memory
    if (!Object.keys(m.files).length) return r
    return { ...r, sections: [...r.sections, { id: 'cockpit:memory', text: memoryText(m.files, 2600, m.features), scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  // Claude's own task list: while it keeps one, the current flow's steps are its tasks, live
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    await trackPlan($, e.tool, e, r, e.agentId)
    return r
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    await trackPlan($, e.tool, e, r, e.agentId)
    return r
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    await trackPlan($, e.tool, e, r, e.agentId)
    return r
  }).catch(($, e, next) => next(e))
  // This app's own task list, and the wrap-up that ticks it off. The matchers are cast loose: the generated
  // types know only the MCP tools connected when they were written, so the literal alone fails tsc in other sessions
  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' } as {}, async ($, e, next) => {
    const r = await next(e)
    await trackPlan($, e.tool, e, r, e.agentId)
    return r
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' } as {}, async ($, e, next) => {
    const r = await next(e)
    await trackPlan($, e.tool, e, r, e.agentId)
    // Its question goes to the judges, in the background: the turn ends as it would
    if (!e.agentId) void judgeNext($, e as unknown as Record<string, unknown>).catch(() => null)
    return r
  }).catch(($, e, next) => next(e))

  // Claude's questions: judges vote in auto mode, the person answers in ask mode or on a split
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId) return next(e)
    const s = await read($, S)
    const now = await $.clock.now()
    const qs = e.questions
    const ids = qs.map((_, i) => `${e.tool_use_id ?? now}-${i}`)
    const decs: Decision[] = qs.map((q, i) => ({ id: ids[i] ?? String(i), q: q.question, opts: q.options.map(o => o.label), at: now, score: 0, signals: [], votes: [], status: 'scoring', result: '' }))
    await set($, st => ({ decisions: [...st.decisions, ...decs].slice(-50), flows: st.flows.map((f, i) => (i === st.flows.length - 1 && f.status === 'running' ? { ...f, decisions: f.decisions + decs.length } : f)) }))

    const askPerson = async () => {
      await set($, { waiting: ids[0] ?? '', activity: 'Waiting for your answer' })
      const r = await next(e)
      const answers = ('result' in r && r.result ? (r.result as { answers?: Record<string, string> }).answers : undefined) ?? {}
      await set($, st => ({
        waiting: '',
        decisions: st.decisions.map(d => (ids.includes(d.id) && d.status !== 'decided' ? { ...d, status: 'you', result: answers[d.q] ? `You chose · ${answers[d.q]}` : 'Answered by you' } : d)),
      }))
      return r
    }

    const judgeable = qs.every(q => !q.multiSelect && q.options.length >= 2 && !PERSONAL.test(q.question) && !q.options.some(o => OPEN.test(o.label)))
    if (s.mode === 'off' || !judgeable) return askPerson()
    // Ask me, or a decision that is hard to undo: the judges advise while the question waits for you
    const risky = qs.some(q => RISKY.test(`${q.question} ${q.options.map(o => `${o.label} ${o.description ?? ''}`).join(' ')}`))
    if (s.mode === 'ask' || risky) {
      for (const [i, q] of qs.entries()) void judge($, ids[i] ?? String(i), q.question, q.options, false).catch(() => null)
      return askPerson()
    }
    const answers: Record<string, string> = {}
    for (const [i, q] of qs.entries()) {
      const win = await judge($, ids[i] ?? String(i), q.question, q.options)
      if (!win) return askPerson()
      answers[q.question] = win
    }
    await set($, { activity: 'Judges decided' })
    return { result: { questions: qs, answers } }
  }).catch(($, e, next) => next(e))

  // A subagent started from the pane: where the engine would hand it to the mode's decider (auto mode's classifier,
  // which judges a spawn by a model request and has none for a press), it is put to the person in the permission
  // dialog instead. A rule or mode that allows it, or one that denies it, stands; every other Agent call is untouched
  on('tool.check', { tool: 'Agent' }, async ($, e, next) => {
    const v = await next(e)
    if (v.decision !== 'ask' || !isOwnStart(e.input)) return v
    const i = (e.input ?? {}) as Record<string, unknown>
    return { decision: 'ask', reason: `Cockpit pane: you asked it to start the ${expertName(String(i.subagent_type ?? 'general-purpose'))} agent` }
  })

  // Subagents the model or anyone else starts show in the Agents tab
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if ('agentId' in r && r.agentId) {
      const id = r.agentId
      // One Cockpit started itself is named by its note; the model's by the event
      // (the note stands while Cockpit's start waits, so a spawn of another type then is the model's, not that one)
      const note = (await read($, S)).starting
      const own = note && (!e.subagentType || e.subagentType === note.type) ? note : null
      const type = e.subagentType || own?.type || 'general-purpose'
      // A twin that runs in a worktree of its own is, to everything else, the agent it is a twin of
      const plain = plainType(type)
      // Who started it: Cockpit's own start is a pipeline's step or yours (a press, a command); else another agent or Claude
      const s0 = await read($, S)
      const by = own ? (s0.pipeline && !s0.pipeline.agentId && s0.pipeline.steps[s0.pipeline.index] === plain ? 'pipeline' : 'you') : e.parentAgentId ? 'agent' : 'claude'
      await trackAgent($, { id, name: own?.name ?? (expertName(plain) !== plain ? expertName(plain) : e.description || plain), type, task: own?.task ?? e.description, prompt: e.prompt, by, ...(e.provider?.plugin ? { provider: e.provider.plugin } : {}), ...(e.parentAgentId ? { parent: e.parentAgentId } : {}), ...(e.cwd ? { cwd: e.cwd } : {}) })
      // A pipeline's expert whose start hands no id back: the id is known here
      await set($, s => ({
        agentTypes: s.agentTypes.includes(plain) ? s.agentTypes : [...s.agentTypes, plain],
        pipeline: s.pipeline && !s.pipeline.agentId && s.pipeline.steps[s.pipeline.index] === plain ? { ...s.pipeline, agentId: id } : s.pipeline,
      }))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // This turn's figures, taken before anything awaits: the next turn may start while this hook still runs, and a
    // failure below must not carry them into it
    const changed = changedThisTurn
    const atStart = changesAtStart
    const snapFlow = turnFlow
    const linesWere = linesAtStart
    if (!e.agentId) {
      changedThisTurn = false
      changesAtStart = null
    }
    const r = await next(e)
    const now = await $.clock.now()
    if (e.agentId) {
      // A pipeline's own step is tested by the pipeline (Build ends in both testers); any other run that changed files is tested here
      const isStep = (await read($, S)).pipeline?.agentId === e.agentId
      await finishAgent($, e.agentId, e.answer, e.isAborted, e.reason === 'error')
      // One that ran in its own worktree: what it changed there, against where it started
      const inWorktree = !!(await read($, S)).agents.find(x => x.id === e.agentId)?.worktree
      if (inWorktree && !(await measureWorktree($, e.agentId).catch(() => null))) await toast($, 'Could not read what the agent changed in its worktree; Bring back reads it again')
      // A notice while you are not watching; a pipeline's step tells you with its pipeline instead
      const fin = (await read($, S)).agents.find(x => x.id === e.agentId)
      // One you stopped yourself needs no notice; several that ran together tell you once, when the last is done
      const all = (await read($, S)).agents
      const busy = all.filter(x => x.id !== e.agentId && x.status === 'running' && !x.for)
      if (!isStep && fin && fin.status !== 'stopped' && !e.isAborted) {
        if (busy.length) batch.set(e.agentId, fin.startedAt)
        else {
          const ran = [...batch.keys()].map(id => all.find(x => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x && x.status !== 'stopped')
          batch.clear()
          await tellDone($, `agent:${[...ran.map(x => x.id), e.agentId].join(',')}`, ran.length ? { kind: 'agents', agents: [...ran, fin] } : { kind: 'agent', agent: fin }).catch(() => null)
        }
      }
      await advancePipeline($, e.agentId, e.answer, e.isAborted)
      // Its work is in its worktree, not your tree: the testers and auto-commit, which work on your tree, wait for Bring back
      if (!isStep && !e.isAborted && !inWorktree) await testAgent($, e.agentId, true)
      // Its work is committed as a turn's is (after the testers instead, where commits wait for them)
      const s = await read($, S)
      const a = s.agents.find(x => x.id === e.agentId)
      if (!isStep && !e.isAborted && !inWorktree && a && changedFiles(a) && !TESTERS.includes(a.type) && s.git.commitMode !== 'manual' && s.git.autoWhen !== 'tests') {
        await refreshRepo($)
        await decideCommit($)
      }
      await saveHistory($)
      return r
    }
    const flowId = (await read($, S)).flows.at(-1)?.id ?? ''
    await set($, st => {
      // A flow that ends in an answer reaches it when the turn completes
      const reached = !e.isAborted && st.reached.length && flowOf(st.task, st.reached, st.flows[st.flows.length - 1]?.kind).steps.includes('Answer') && !st.reached.includes('Answer') ? [...st.reached, 'Answer'] : st.reached
      return {
        isWorking: false,
        // A question the person never answered (the turn was interrupted) waits no longer
        waiting: '',
        activity: 'Done',
        // The engine's own figure, the one the TurnDuration row is matched against
        lastTurnMs: e.durationMs,
        reached,
        flows: st.flows.map((f, i) => (i === st.flows.length - 1 && f.status === 'running' ? { ...f, status: e.isAborted ? ('aborted' as const) : ('done' as const), endedAt: now, reached, ms: e.durationMs } : f)),
      }
    })
    await refreshRepo($)
    // And as the turn left it, before any auto-commit
    await snapTurn($, snapFlow || flowId, 'after').catch(() => null)
    await measure($)
    await syncAgents($)
    const s = await read($, S)
    const didChange = changed || (atStart !== null && s.repo.changed.length > 0 && changesOf(s.repo.changed) !== atStart)
    // The autopilot's next cycle, once this turn's figures are in (cost for its budget, changes for its stall count)
    // A failure here must not leave the run marked running with no next cycle: it pauses, saying why
    // The cycle this turn was, before the autopilot moves on to the next
    const endedCycle = s.autopilot?.status === 'running' ? s.autopilot.cycle : 0
    await autopilotTurnEnd($, e.answer ?? '', didChange, !!e.isAborted, s.turnStart).catch(err => stopAutopilot($, 'paused', `its turn's end failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`).catch(() => null))
    // Files a shell command or script changed reach the memory here
    if (didChange) for (const c of s.repo.changed.slice(0, 40)) await updateMemory($, `${await repoRootOf($)}/${c.path}`)
    // The flow's +/− counts what changed in the repository this turn, a shell command's edits too: the lines each file
    // gained since the turn started, or the edits' own count where that is more
    // ponytail: git's numstat leaves untracked files out, so a new file a shell command wrote counts no lines
    if (didChange && atStart !== null) {
      const was = new Map(linesWere.map(c => [c.path, c]))
      const add = s.repo.changed.reduce((n, c) => n + Math.max(0, c.add - (was.get(c.path)?.add ?? 0)), 0)
      const del = s.repo.changed.reduce((n, c) => n + Math.max(0, c.del - (was.get(c.path)?.del ?? 0)), 0)
      await set($, st => ({ flows: st.flows.map(f => (f.id === flowId ? { ...f, add: Math.max(f.add, add), del: Math.max(f.del, del) } : f)) }))
    }
    // A notice while you are not watching: the autopilot's cycle while one runs, else the turn
    const now2 = await read($, S)
    const ap = now2.autopilot
    const fl = now2.flows.find(f => f.id === flowId)
    if (ap && endedCycle && !e.isAborted) await tellDone($, `cycle:${ap.at}:${endedCycle}`, { kind: 'cycle', cycle: endedCycle, ticked: ap.done, total: ap.total, spent: Math.max(0, now2.cost - ap.costAt), ...(ap.status !== 'running' ? { ended: ap.status } : {}) }).catch(() => null)
    else if (fl && !e.isAborted) {
      const vs = verifyState(now2.agents)
      await tellDone($, `turn:${flowId}:${e.turnId}`, { kind: 'turn', task: fl.task, files: now2.repo.changed.length, add: fl.add, del: fl.del, ...(vs.cases.length ? { tests: { pass: vs.pass, total: vs.cases.length } } : {}) }).catch(() => null)
    }
    const commitAfterTests = s.git.commitMode !== 'manual' && s.git.autoWhen === 'tests'
    if (didChange && (s.autoVerify || commitAfterTests)) await startPipeline($, 'verify')
    if (didChange && s.git.commitMode !== 'manual' && s.git.autoWhen !== 'tests') await decideCommit($)
    await saveHistory($)
    // The daily budget: a warning at 80% and at 100%, once each a day
    const sb = await read($, S)
    await checkBudget($, withCurrent(sb.pastSessions, sb.sessionAt, await $.clock.now(), sb.cost, sb.ctx.used, sb.flows.length), await $.clock.now()).catch(() => null)
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
  })

  // What another plugin hooking Cockpit calls: they read the state and change it through these, answered here, where
  // the state is written; `act` runs an action of ./actions by name, its result handed back as plain data
  on('engine.create', async (_$, e, next) => ({ ...(await next(e)), cockpit: { set: async () => true, act: async () => null, tab: async () => true } }))
  on('cockpit.set', async ($, e) => {
    await set($, e.patch as Partial<Ph>)
    return { value: true }
  })
  on('cockpit.act', async ($, e) => {
    if (!(ACTS as readonly string[]).includes(e.name)) return { deny: `Cockpit has no action ${e.name}` }
    const r = await act($, e.name, e.args)
    return { value: r === undefined ? null : JSON.parse(JSON.stringify(r)) }
  })
  // An add-on says which tab it draws; the pane shows only those, and opens on one of them
  on('cockpit.tab', async ($, e) => {
    await set($, st => {
      const tabs = [...new Set([...(st.tabsAvailable ?? []), e.id])]
      return { tabsAvailable: tabs, tab: tabs.includes(st.tab) ? st.tab : (tabs[0] ?? st.tab) }
    })
    return { value: true }
  })
  // The band, spinner and chat cards (drawings.tsx), and the pane (full-pane.tsx)
  drawings(on)
  fullPane(on, () => root)
}

// The current flow's plan after one of Claude's plan tools ran (a refused call changes nothing)
// A task list kept by the main loop is the current flow's; one a subagent keeps is that agent's own, its progress
async function trackPlan($: EngineInterface, tool: string, e: unknown, r: unknown, agentId?: string) {
  // A refused or failed plan call changed no list: a failed TaskCreate has no id, and would leave a ghost task
  if (typeof r !== 'object' || r === null || ('deny' in r && (r as { deny?: unknown }).deny) || ('isError' in r && (r as { isError?: unknown }).isError)) return
  const result = 'result' in r ? (r as { result?: unknown }).result : undefined
  if (agentId) {
    const known = (await read($, S)).agents.some(a => a.id === agentId)
    // ponytail: ids that never get a row are held to the last 40
    if (!known && earlyPlans.size >= 40 && !earlyPlans.has(agentId)) earlyPlans.delete(earlyPlans.keys().next().value!)
    if (!known) return void earlyPlans.set(agentId, applyPlan(earlyPlans.get(agentId) ?? [], tool, e as Record<string, unknown>, result))
    return set($, s => ({ agents: s.agents.map(a => (a.id === agentId ? { ...a, plan: applyPlan(a.plan ?? [], tool, e as Record<string, unknown>, result) } : a)) }))
  }
  await set($, s => ({
    flows: s.flows.map((f, i) => (i === s.flows.length - 1 ? { ...f, plan: applyPlan(f.plan ?? [], tool, e as Record<string, unknown>, result, s.flows.slice(0, -1).map(x => x.plan ?? [])) } : f)),
  }))
}

// The flow-opening half of a prompt: a new flow, the repo read first; returns its changes as they stood, to compare at the turn's end
async function openFlow($: EngineInterface, text: string, now: number) {
  await refreshRepo($)
  const changes = (await read($, S)).repo.changed
  const task = text.trim().split('\n')[0] ?? ''
  await set($, s => ({
    task,
    turnStart: now,
    isWorking: true,
    activity: 'Reading the request',
    reached: ['Understand'],
    // The previous flow closes if it was still open; this prompt opens a new one
    flows: [...s.flows.map(f => (f.status === 'running' ? { ...f, status: 'aborted' as const, endedAt: now } : f)), { id: `f${now}`, task, startedAt: now, status: 'running' as const, reached: ['Understand'], ops: 0, add: 0, del: 0, decisions: 0, commit: '', costAt: s.cost }].slice(-30),
  }))
  return changes
}

// A turn that carries on the last flow: it runs again, one turn more, its plan and steps kept
async function resumeFlow($: EngineInterface, now: number) {
  await refreshRepo($)
  const changes = (await read($, S)).repo.changed
  await set($, s => {
    const f = s.flows[s.flows.length - 1]!
    const { endedAt: _, ...open } = f
    return { task: f.task, turnStart: now, isWorking: true, activity: 'Carrying on', reached: f.reached, flows: [...s.flows.slice(0, -1), { ...open, status: 'running' as const, turns: (f.turns ?? 1) + 1 }] }
  })
  return changes
}
