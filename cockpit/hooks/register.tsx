import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Changed, Decision, Tab, ThemeId } from '../types'
import {
  advancePipeline,
  commit,
  confirmPending,
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
  judgeNext,
  personSpoke,
  RISKY,
  PERSONAL,
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
  skipPending,
  refreshRepo,
  registerExperts,
  set,
  startPipeline,
  setTheme,
  trackAgent,
} from './actions'
import { EXPERTS, FLOWS, PIPELINES, activityOf, applyPlan, base, expertName, flowOf, fmt, kTok, progress, selfCheck, stepOf, tally, toOp, verifyState } from './logic'
import { memoryText } from './memory'
import { INITIAL, PANE } from './state'
import { THEME_IDS, chatThemeOf, ctxShades, themeOf } from './theme'
import { Agents, Card, Files, Git, Header, Overview, Tabs, seatDots } from './views'
import type { UI } from './views'

// The session's Cockpit state (see state.ts)
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-23' })

const TABS: Tab[] = ['overview', 'files', 'agents', 'git']

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
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    root = await $.session.cwd()
    // The command and the timers first: a load below that fails must not leave /cockpit unregistered
    await $.command.register({
      name: 'cockpit',
      description: 'Open the Cockpit pane; or: focus [on|off], theme <auto|paper|white|black|solarized|nord>, mode <auto|ask|off>, tab <name>, flow <plan|task|build|docs|check|answer>, run <agents> [-- task], test',
      argumentHint: '[focus [on|off] | theme <name> | mode <auto|ask|off> | tab <name> | flow <name> | run <agents> [-- task] | test]',
    })
    for (const t of timers) t.cancel()
    timers = []
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
        await measure($)
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
    if (verb === 'tab' && arg === 'git') await refreshRepo($)
    if (verb === 'tab' && arg === 'files') await loadProject($)
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
      // The codebase memory follows every edit, an agent's too
      if (/^(Edit|Write|NotebookEdit|MultiEdit)$/.test(e.tool)) await updateMemory($, String(input.file_path ?? input.notebook_path ?? ''))
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
    if (r.deny || r.isError) return r
    if (op && (op.op === 'Write' || op.op === 'Edit' || op.op === 'Delete')) changedThisTurn = true
    if (op && (op.op === 'Write' || op.op === 'Edit')) await updateMemory($, op.path)
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
    if (!e.agentId) await trackPlan($, e.tool, e, r)
    return r
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await trackPlan($, e.tool, e, r)
    return r
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await trackPlan($, e.tool, e, r)
    return r
  }).catch(($, e, next) => next(e))
  // This app's own task list, and the wrap-up that ticks it off
  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await trackPlan($, e.tool, e, r)
    return r
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await trackPlan($, e.tool, e, r)
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

    const judgeable = qs.every(q => !q.multiSelect && q.options.length >= 2 && !PERSONAL.test(q.question))
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
      await trackAgent($, { id, name: own?.name ?? (expertName(type) !== type ? expertName(type) : e.description || type), type, task: own?.task ?? e.description, prompt: e.prompt })
      // A pipeline's expert whose start hands no id back: the id is known here
      await set($, s => ({
        agentTypes: s.agentTypes.includes(type) ? s.agentTypes : [...s.agentTypes, type],
        pipeline: s.pipeline && !s.pipeline.agentId && s.pipeline.steps[s.pipeline.index] === type ? { ...s.pipeline, agentId: id } : s.pipeline,
      }))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // This turn's figures, taken before anything awaits: the next turn may start while this hook still runs, and a
    // failure below must not carry them into it
    const changed = changedThisTurn
    const atStart = changesAtStart
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
      await advancePipeline($, e.agentId, e.answer, e.isAborted)
      if (!isStep && !e.isAborted) await testAgent($, e.agentId, true)
      // Its work is committed as a turn's is (after the testers instead, where commits wait for them)
      const s = await read($, S)
      const a = s.agents.find(x => x.id === e.agentId)
      if (!isStep && !e.isAborted && a && changedFiles(a) && !TESTERS.includes(a.type) && s.git.commitMode !== 'manual' && s.git.autoWhen !== 'tests') {
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
        flows: st.flows.map((f, i) => (i === st.flows.length - 1 && f.status === 'running' ? { ...f, status: e.isAborted ? ('aborted' as const) : ('done' as const), endedAt: now, reached } : f)),
      }
    })
    await refreshRepo($)
    await measure($)
    await syncAgents($)
    const s = await read($, S)
    const didChange = changed || (atStart !== null && s.repo.changed.length > 0 && changesOf(s.repo.changed) !== atStart)
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
    const commitAfterTests = s.git.commitMode !== 'manual' && s.git.autoWhen === 'tests'
    if (didChange && (s.autoVerify || commitAfterTests)) await startPipeline($, 'verify')
    if (didChange && s.git.commitMode !== 'manual' && s.git.autoWhen !== 'tests') await decideCommit($)
    await saveHistory($)
    return r
  }).catch(async ($, e, next) => {
    // Whatever failed, the main turn is over: the band and the timers must not think it still runs
    if (!e.agentId) await set($, { isWorking: false, waiting: '' }).catch(() => null)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($)
    return next(e)
  })

  // Activity line in place of the spinner: ✻ what is happening · elapsed
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const s = await read($, S)
    const mode = e.props.mode
    const what = s.waiting ? 'Waiting for your answer' : mode === 'thinking' ? 'Thinking' : mode === 'requesting' ? 'Sending' : mode === 'responding' ? 'Writing' : s.activity
    // The desktop keeps its own row and takes only its words
    if (e.surface !== 'terminal') return next({ ...e, props: { ...e.props, message: what } })
    const { Box, Text } = $.ui.resolve(e)
    const t = chatThemeOf(s)
    const now = await $.clock.now()
    const glyph = ['✻', '✼', '✽', '✾', '✽', '✼'][Math.floor(now / 180) % 6]
    return (
      <Box justifyContent="space-between" marginTop={1}>
        <Text>
          <Text color={t.accent}>{`${glyph} `}</Text>
          <Text color={t.text}>{what}</Text>
          {mode === 'thinking' && s.activity !== 'Done' && s.activity !== 'Reading the request' && <Text color={t.dim}>{` · after ${s.activity.toLowerCase()}`}</Text>}
        </Text>
        <Text color={t.dim}>{s.turnStart ? fmt(now - s.turnStart) : ''}</Text>
      </Box>
    )
  })

  // Band above the prompt: a box with Progress and Context, a Focus switch in its header; one line while Focus is on
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, S)
    const t = themeOf(s)
    const p = progress(s)
    const win = s.ctx.window || 200000
    const toggle = (
      <Button key="ph-focus" plain onPress={() => set($, st => ({ focus: st.focus === false }))}>
        <Text color={s.focus !== false ? t.accent : t.dim}>{s.focus !== false ? '◉ Focus' : '○ Focus'}</Text>
      </Button>
    )
    // The Verify experts in one phrase, for the one-line band
    const vs = verifyState(s.agents)
    const testsFail = vs.fail > 0
    const testsLine = vs.running ? 'testing…' : vs.cases.length ? `tests ${vs.pass}/${vs.cases.length}` : ''
    const pipe = s.pipeline && (
      <Text>
        <Text color={t.accent}>{'⧉ '}</Text>
        <Text color={t.text}>{`${PIPELINES.find(p => p.name === s.pipeline?.name)?.label ?? s.pipeline.name} pipeline`}</Text>
        <Text color={t.dim}>{` · ${s.pipeline.index + 1}/${s.pipeline.steps.length} · ${expertName(s.pipeline.steps[s.pipeline.index] ?? '')}…`}</Text>
      </Text>
    )
    // What the judges recommend, while the question waits for you: Claude's question, or this turn's next step
    const adv = s.decisions
      .slice()
      .reverse()
      .find(d => !!d.advice && d.status !== 'you' && (d.id === s.waiting || (d.kind === 'next' && d.at >= s.turnStart)))
    const advice = adv && (
      <Text wrap="truncate-end">
        <Text color={t.accent}>{'⚖ '}</Text>
        <Text color={t.text}>{adv.advice}</Text>
      </Text>
    )
    // A proposed commit waits for Commit or Skip right above the prompt
    const ask = s.pending && (
      <Box borderStyle="round" borderColor={t.accent} paddingX={1} justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        <Text>
          <Text color={t.busy}>{'⎇ Commit? '}</Text>
          <Text color={t.text} wrap="truncate-end">{s.pending.msg}</Text>
          <Text color={t.dim}>{` → ${s.pending.branch} · ${s.pending.files.length} files`}</Text>
        </Text>
        <Box gap={1}>
          <Button key="ph-commit" label="Commit" variant="primary" onPress={() => confirmPending($)} />
          <Button key="ph-skip" label="Skip" onPress={() => skipPending($)} />
        </Box>
      </Box>
    )
    if (s.focus !== false) {
      return (
        <Box flexDirection="column" marginTop={1} backgroundColor={t.bg || undefined}>
        {ask}
        {advice}
        <Box borderStyle="round" borderColor={t.dim} paddingX={1} justifyContent="space-between" flexWrap="wrap">
          <Text>
            <Text color={t.accent}>{`${p.pct}%`}</Text>
            <Text color={t.dim}>{` ${p.stepName}  ·  context `}</Text>
            <Text color={s.ctx.pct >= 80 ? t.busy : t.text}>{`${s.ctx.pct}%`}</Text>
            {testsLine && <Text color={testsFail ? t.bad : testsLine === 'testing…' ? t.busy : t.ok}>{`  ·  ${testsLine}`}</Text>}
          </Text>
          {toggle}
        </Box>
        </Box>
      )
    }
    // Columns: label 10, bar, figures; border and padding take 4. Too narrow for that, the figures go above a full-width bar
    const right1 = `  ${p.pct}% · ${p.stepName}`
    const right2 = `  ${s.ctx.pct}% · ${kTok(s.ctx.used)} / ${kTok(win)}`
    const tail = Math.max(right1.length, right2.length)
    const inner = e.props.bodyColumns - 4
    const narrow = inner < 10 + 12 + tail
    const bw = narrow ? Math.max(6, inner) : inner - 10 - tail
    const gaps = p.steps.length - 1
    const segW = Math.max(1, Math.floor((bw - gaps) / p.steps.length))
    const shades = ctxShades(t)
    let left = bw
    const ctxCells = s.ctx.segs.map(([name, n], i) => {
      const k = Math.min(left, Math.round((n / win) * bw))
      left -= k
      return <Text key={`cx-${name}`} color={shades[i] ?? t.faint}>{'━'.repeat(k)}</Text>
    })
    const progressLabel = (
      <Button key="ph-progress" plain onPress={() => set($, { tab: 'overview' })}>
        <Text color={t.dim}>Progress</Text>
      </Button>
    )
    const contextLabel = (
      <Button key="ph-context" plain onPress={() => set($, { tab: 'overview' })}>
        <Text color={t.dim}>Context</Text>
      </Button>
    )
    return (
      <Box flexDirection="column" marginTop={1} backgroundColor={t.bg || undefined}>
        {ask}
        {advice}
        {pipe}
        <Box flexDirection="column" borderStyle="round" borderColor={t.dim} paddingX={1}>
          <Box justifyContent="space-between">
            <Text color={t.faint}>cockpit</Text>
            {toggle}
          </Box>
          {narrow && (
            <Box columnGap={1}>
              {progressLabel}
              <Text>
                <Text color={t.text}>{`${p.pct}%`}</Text>
                <Text color={t.dim}>{` · ${p.stepName}`}</Text>
              </Text>
            </Box>
          )}
          <Box>
            {!narrow && <Box width={10}>{progressLabel}</Box>}
            <Text mono>
            {p.steps.map((x, i) => {
              const k = x.st === 'done' ? segW : x.st === 'active' ? Math.max(1, Math.round(segW / 2)) : 0
              return (
                <Text key={`pg-${x.name}`}>
                  <Text color={t.accent}>{'━'.repeat(k)}</Text>
                  <Text color={t.track}>{(x.st === 'skipped' ? '╌' : '━').repeat(segW - k)}</Text>
                  {i < gaps && <Text> </Text>}
                </Text>
              )
            })}
            <Text color={t.track}>{'━'.repeat(Math.max(0, bw - segW * p.steps.length - gaps))}</Text>
            </Text>
            {!narrow && <Text color={t.text}>{`  ${p.pct}%`}</Text>}
            {!narrow && <Text color={t.dim}>{` · ${p.stepName}`}</Text>}
          </Box>
          {narrow && (
            <Box columnGap={1}>
              {contextLabel}
              <Text>
                <Text color={s.ctx.pct >= 80 ? t.busy : t.text}>{`${s.ctx.pct}%`}</Text>
                <Text color={t.dim}>{` · ${kTok(s.ctx.used)} / ${kTok(win)}`}</Text>
              </Text>
            </Box>
          )}
          <Box>
            {!narrow && <Box width={10}>{contextLabel}</Box>}
            <Text mono>
              {ctxCells}
              <Text color={t.track}>{'━'.repeat(Math.max(0, left))}</Text>
            </Text>
            {!narrow && <Text color={s.ctx.pct >= 80 ? t.busy : t.text}>{`  ${s.ctx.pct}%`}</Text>}
            {!narrow && <Text color={t.dim}>{` · ${kTok(s.ctx.used)} / ${kTok(win)}`}</Text>}
          </Box>
        </Box>
      </Box>
    )
  })

  // Chat cards: tool rows drawn as the design's cards; ctrl+o, errors and interrupts keep the engine's row
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    if (p.isExpanded || p.isErrored || p.isInterrupted) return next(e)
    const s = await read($, S)
    const t = chatThemeOf(s)
    const table = $.ui.resolve(e)
    if (s.focus !== false) return <table.Box display='none' />
    const ui = { Box: table.Box, Text: table.Text, Button: table.Button } as UI
    const { Text } = table
    const w = Math.max(30, (e.viewport?.columns ?? 100) - 4)
    const input = (p.input ?? {}) as Record<string, unknown>
    const id = e.requestId
    if (p.tool === 'AskUserQuestion') {
      const d = s.decisions.find(x => x.id.startsWith(`${id}-`))
      if (!d) return next(e)
      const open = () => set($, st => ({ tab: 'overview', ui: { ...st.ui, openDec: d.id } }))
      if (d.status === 'you') return <Card ui={ui} t={t} w={w} id={id} dashed={false} icon="⚖" left={<Text color={t.text}>You decided</Text>} right={d.result.replace(/^You chose · /, '')} onPress={open} />
      const tl = tally(d)
      const left = [<Text key="jn" color={t.text}>{`${tl.n || '…'} judges `}</Text>, ...seatDots(ui, t, d)]
      const right = d.status === 'voting' ? `voting ${tl.revealed}/${tl.n}` : d.status === 'scoring' ? 'scoring…' : d.status === 'split' ? 'split · asking you' : `${tl.yes}/${tl.n} → ${d.opts[tl.top] ?? ''}`
      return <Card ui={ui} t={t} w={w} id={id} dashed={false} icon="⚖" left={left} right={right} onPress={open} />
    }
    if (p.tool === 'Agent' || p.tool === 'Task') {
      const task = String(input.description ?? input.prompt ?? '').split('\n')[0] ?? ''
      const type = String(input.subagent_type ?? 'Agent')
      const a = s.agents.filter(x => x.task === task).pop()
      const status = p.isRunning ? 'Running' : a ? { running: 'Running', done: 'Done', stopped: 'Stopped', failed: 'Failed' }[a.status] : 'Done'
      return <Card ui={ui} t={t} w={w} id={id} dashed icon="⧉" left={<Text color={t.text}>{`${type} subagent · ${task}`}</Text>} right={status} onPress={() => set($, st => ({ tab: 'agents', ui: { ...st.ui, openAgent: a?.id ?? '' } }))} />
    }
    if (p.tool === 'Bash' && /\bgit commit\b/.test(String(input.command)) && !p.isRunning) {
      const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '')
      const m = out.match(/\[[^\]\s]+ ([0-9a-f]{7,})\] ([^\n"]+)/)
      return <Card ui={ui} t={t} w={w} id={id} dashed={false} icon="⎇" left={<Text color={t.text}>{m ? `Committed ${m[1]} · ${m[2]}` : 'Committed'}</Text>} right="" onPress={() => set($, { tab: 'git' })} />
    }
    const op = s.ops.find(o => o.id === id)
    if (!op) return next(e)
    const name = op.op === 'Search' ? op.path : base(op.path)
    const right = p.isRunning ? '…' : op.add || op.del ? `+${op.add} −${op.del} →` : op.op === 'Read' ? '1 file →' : '→'
    return <Card ui={ui} t={t} w={w} id={id} dashed={op.op !== 'Delete'} icon="◇" left={<Text color={t.text}>{`${op.op} ${name}`}</Text>} right={right} onPress={() => set($, st => ({ tab: 'files', ui: { ...st.ui, fileView: 'list', openFile: op.id } }))} />
  })

  // A folded run of reads and searches, as one card
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const ops = e.props.calls.map((c, i) => toOp(c.tool, (c.input ?? {}) as Record<string, unknown>, c.tool_use_id ?? `g${i}`, 0)).filter(o => o !== null)
    const s = await read($, S)
    const table = $.ui.resolve(e)
    if (s.focus !== false) return <table.Box display='none' />
    if (!ops.length) return next(e)
    const t = chatThemeOf(s)
    const ui = { Box: table.Box, Text: table.Text, Button: table.Button } as UI
    const text = ops.map(o => (o.op === 'Search' ? `Search ${o.path.split('  ')[1] ?? ''}` : `${o.op} ${base(o.path)}`)).join(' · ')
    const files = new Set(ops.filter(o => o.op !== 'Search').map(o => o.path)).size
    return <Card ui={ui} t={t} w={Math.max(30, (e.viewport?.columns ?? 100) - 4)} id={e.requestId} dashed icon="◇" left={<table.Text color={t.text}>{text}</table.Text>} right={`${files || ops.length} ${files === 1 ? 'file' : 'files'} →`} onPress={() => set($, st => ({ tab: 'files', ui: { ...st.ui, fileView: 'list' } }))} />
  })

  // The line a finished turn leaves: ✻ Done … Done in m:ss
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, S)
    if (s.focus !== false) return <Box display='none' />
    const t = chatThemeOf(s)
    // ponytail: the latest turn is told by its duration matching the one turn.complete measured; two equal turns both match
    const isLatest = Math.abs(e.props.durationMs - s.lastTurnMs) < 2500
    return (
      <Box justifyContent="space-between" width={Math.max(30, (e.viewport?.columns ?? 100) - 2)}>
        <Text>
          <Text color={t.accent}>✻ </Text>
          <Text color={t.text}>{isLatest && s.repo.changed.length ? 'Done · ready to commit' : 'Done'}</Text>
        </Text>
        <Text color={t.dim}>{`Done in ${fmt(e.props.durationMs)}`}</Text>
      </Box>
    )
  })

  // Your prompts as the design's "›" rows; notifications and ctrl+o keep the engine's own
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.origin.kind !== 'composer') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const t = chatThemeOf(await read($, S))
    return (
      <Box backgroundColor={t.surface || undefined} paddingX={1} width={Math.max(30, (e.viewport?.columns ?? 100) - 2)}>
        <Text color={t.hi}>{'› '}</Text>
        <Text color={t.text}>{e.props.text}</Text>
      </Box>
    )
  })

  // Claude's replies with the design's "●" mark, markdown kept
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const table = $.ui.resolve(e)
    if (!('Markdown' in table)) return next(e)
    const { Box, Markdown, Text } = table
    const t = chatThemeOf(await read($, S))
    return (
      <Box>
        <Text color={t.accent}>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        <Box flexGrow={1}>
          <Markdown key="reply" text={e.props.text} />
        </Box>
      </Box>
    )
  })

  // Status row under the prompt: [cockpit] ⎇ branch ↑ahead · diff · tests · cost · mode
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, S)
    const t = chatThemeOf(s)
    const vs = verifyState(s.agents)
    const all = vs.cases
    const pass = vs.pass
    const fail = vs.fail
    const adds = s.repo.changed.reduce((a, c) => a + c.add, 0)
    const dels = s.repo.changed.reduce((a, c) => a + c.del, 0)
    return (
      <Box gap={2}>
        <Text color={t.hi}>{s.focus !== false ? '[cockpit · focus]' : '[cockpit]'}</Text>
        {s.repo.isRepo && <Text color={t.accent}>{`⎇ ${s.repo.current}${s.repo.ahead ? ` ↑${s.repo.ahead}` : ''}`}</Text>}
        {s.accounts.some(a => a.id === s.accountId) && <Text color={t.dim}>{`@ ${s.accounts.find(a => a.id === s.accountId)?.label}`}</Text>}
        {adds || dels ? (
          <Text>
            <Text color={t.ok}>{`+${adds}`}</Text>
            <Text color={t.bad}>{` −${dels}`}</Text>
          </Text>
        ) : (
          <Text color={t.dim}>no changes</Text>
        )}
        <Text color={fail ? t.bad : all.length ? t.ok : t.dim}>{`tests ${all.length ? `✓${pass}${fail ? ` ✗${fail}` : ''}/${all.length}` : '—'}`}</Text>
        <Text color={t.accent}>{`$${s.cost.toFixed(2)}`}</Text>
        <Text color={t.dim}>{s.mode === 'auto' ? 'Auto · judge' : s.mode === 'ask' ? 'Ask · advice' : 'Judges off'}</Text>
        {e.props.isWorking && <Text color={t.faint}>esc to interrupt</Text>}
      </Box>
    )
  })

  // The side pane: header, tabs, and the open tab
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const s = await read($, S)
    const t = themeOf(s)
    if (!('Input' in table) || !('Select' in table)) {
      return <table.Text color={t.dim}>Cockpit needs a surface with fields.</table.Text>
    }
    const ui: UI = { Box: table.Box, Text: table.Text, Button: table.Button, Input: table.Input, Select: table.Select, ...('Svg' in table && e.surface !== 'terminal' ? { Svg: table.Svg } : {}) }
    const v = { ui, s, t, w: Math.max(16, e.props.bodyColumns - 2), now: await $.clock.now(), root, desk: e.surface !== 'terminal' }
    const { Box } = ui
    // A palette paints its own background over the whole pane, so its text reads on any terminal
    const rows = (e.props as { scroll?: { bodyRows?: number } }).scroll?.bodyRows
    return (
      <Box flexDirection="column" paddingX={1} backgroundColor={t.bg || undefined} {...(t.bg && rows ? { minHeight: rows } : {})}>
        {Header($, v)}
        {Tabs($, v)}
        {s.tab === 'overview' && Overview($, v)}
        {s.tab === 'files' && Files($, v)}
        {s.tab === 'agents' && Agents($, v)}
        {s.tab === 'git' && Git($, v)}
      </Box>
    )
  })

}

// The current flow's plan after one of Claude's plan tools ran (a refused call changes nothing)
async function trackPlan($: EngineInterface, tool: string, e: unknown, r: unknown) {
  if (typeof r !== 'object' || r === null || ('deny' in r && (r as { deny?: unknown }).deny)) return
  const result = 'result' in r ? (r as { result?: unknown }).result : undefined
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
    flows: [...s.flows.map(f => (f.status === 'running' ? { ...f, status: 'aborted' as const, endedAt: now } : f)), { id: `f${now}`, task, startedAt: now, status: 'running' as const, reached: ['Understand'], ops: 0, add: 0, del: 0, decisions: 0, commit: '' }].slice(-30),
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
