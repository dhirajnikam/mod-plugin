import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Account, Agent, Autopilot, Changed, RuleFiles, Commit, Decision, Flow, GitForm, Pending, Ph, ThemeId, PlanItem } from '../../types'
import { parseSettings, settingsText } from '../rules'
import { factsOf, featurePrompt, filesSig, importers, isCode, memoryKey, memoryMarkdown, parseFeatures, parseImports, resolveImport } from '../memory'
import { AGENT_TYPES, EXPERTS, PIPELINES, TYPES, recallOf, similarRuns, parseCommit, parseSteps, base, branchName, commitMsg, expertName, inferType, nJ, parseCases, parseReport, tally, verifyState } from '../logic'
import { INITIAL, PANE } from '../state'
import { THEME_IDS } from '../theme'
import type { $ } from './core'
import { cockpitDir, note, saveHistory, set, summary, toast } from './core'
import { beforeIsolated, decideCommit, dropWorktree, findIsolated, makeWorktree, refreshRepo } from './git'

// The session's state, declared here as in every module that reads it: the engine reads a state atom from its literal
// plugin and key in the module that names it, so each reader declares the same atom
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-23' })

// Spawns started from the pane right now, each its type and exact prompt: the tool.check hook puts these to the person
const ownStarts: { type: string; prompt: string }[] = []
export function isOwnStart(input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>
  return ownStarts.some(o => o.type === (i.subagent_type ?? 'general-purpose') && o.prompt === i.prompt)
}

// Starts a subagent in the background and settles once it has started, with its id
export async function startAgent($: $, a: { prompt: string; description: string; type: string; cwd?: string }) {
  const own = { type: a.type, prompt: a.prompt }
  ownStarts.push(own)
  const r = await $.agent.spawn({ prompt: a.prompt, description: a.description, subagentType: a.type, ...(a.cwd ? { cwd: a.cwd } : {}) })
    .catch(e => ({ deny: String(e) }))
    .finally(() => ownStarts.splice(ownStarts.indexOf(own), 1))
  if ('deny' in r && r.deny) return { deny: r.deny }
  return { agentId: 'agentId' in r && r.agentId ? r.agentId : '' }
}

// The experts from the mod's own agents/*.md, registered as cockpit:<name> so they dispatch however the mod was loaded
// (a plugin's agent files are read only at startup; a mod that loads later, or reloads, registers its own)
export async function registerExperts($: $) {
  const dir = `${$.plugin.root}/agents`
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (!f.name.endsWith('.md')) continue
    const text = await $.fs.read(`${dir}/${f.name}`).catch(() => '')
    const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!m) continue
    const head: Record<string, string> = Object.fromEntries((m[1] ?? '').split('\n').map(l => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]).filter(([k]) => k))
    const name = head.name || f.name.slice(0, -3)
    const tools = String(head.tools ?? '').split(',').map((t: string) => t.trim()).filter(Boolean)
    const spec = { name, description: head.description || `Cockpit's ${name}`, prompt: (m[2] ?? '').trim(), ...(head.model ? { model: head.model } : {}), ...(tools.length ? { tools } : {}) }
    const r = await $.agent.register(spec).catch(e => ($.ui.log(`cockpit: could not register the ${spec.name}: ${String(e)}`), null))
    await registerIsolated($, r?.agent ?? `cockpit:${name}`, spec)
  }
  // A general-purpose agent in its own worktree, for a task from the New agent form
  await registerIsolated($, 'general-purpose', { name: 'agent', description: 'Works on the task it is given', prompt: 'You work on the task you are given, in the folder you start in. Keep to the task, and say at the end what you changed.' })
  // And the agents made from a description, kept in the store across sessions
  const made = ((await $.store.get('agents').catch(() => undefined)) ?? []) as MadeAgent[]
  const custom: Ph['custom'] = []
  for (const m of made) {
    const r = await $.agent.register(m).catch(() => null)
    if (r) custom.push({ type: r.agent, name: expertName(r.agent), what: m.description })
    if (r) await registerIsolated($, r.agent, m)
  }
  await set($, { custom })
}

// What every agent Cockpit makes is told, as the experts' own files say it
const PLAN_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate']
const AGENT_RULES = 'Keep a short task list with your todo tool (TodoWrite, or TaskCreate and TaskUpdate): three to six steps, each marked in progress when you start it and completed when it is done. Cockpit shows it as your progress.\n\nNever commit, push, switch branches or stash: Cockpit handles git. Never write to .cockpit/ (reading .cockpit/roadmap.md is fine).'
type MadeAgent = { name: string; description: string; prompt: string; tools?: string[] }
const TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch']

// An agent from the person's own words: a model writes its definition, Cockpit registers it as cockpit:<name>
// (runnable at once, here and by Claude) and keeps it in the store for later sessions
export async function createAgent($: $, describe: string) {
  if ((await read($, S)).creating) return toast($, 'Still making the last agent')
  await set($, { creating: describe })
  try {
    // privacy: agent-definition (docs/privacy.md lists what it sends)
    const r = await $.model.complete({
      model: 'sonnet',
      maxTokens: 3000,
      system: 'You write Claude Code subagent definitions. Answer with one JSON object and nothing else.',
      prompt: `The person wants this agent:\n${describe}\n\nAnswer with JSON: {"name": short kebab-case, 2 to 40 characters, "description": one line saying what it does and when to use it, "tools": the tools it needs from ${JSON.stringify(TOOLS)}, or [] for every tool, "prompt": its whole system prompt in the second person: its role, how it works step by step, what it must not do, and that its answer ends with a line "REPORT: <one line of what it found or did>" and a line "HANDOFF: <what the next agent should look at>"}`,
    })
    const json = r.isAnswered ? r.text.match(/\{[\s\S]*\}/)?.[0] : undefined
    const raw = json ? (JSON.parse(json) as Partial<MadeAgent>) : {}
    const name = String(raw.name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    if (!name || !raw.description || !raw.prompt) return toast($, r.isAnswered ? 'Could not make the agent: the definition came back incomplete' : `Could not make the agent: ${r.reason}`)
    if (EXPERTS.some(x => x.type === `cockpit:${name}`)) return toast($, `"${name}" is one of Cockpit's own experts: describe it differently`)
    const tools = (Array.isArray(raw.tools) ? raw.tools : []).filter(t => TOOLS.includes(t))
    // Every agent keeps a task list Cockpit can track, and leaves git to Cockpit, as the experts do
    const spec: MadeAgent = { name, description: String(raw.description), prompt: `${String(raw.prompt).trim()}\n\n${AGENT_RULES}`, ...(tools.length ? { tools: [...new Set([...tools, ...PLAN_TOOLS])] } : {}) }
    const reg = await $.agent.register(spec).catch(e => ({ deny: String(e) }))
    if ('deny' in reg) return toast($, `Could not register the agent: ${reg.deny}`)
    const made = ((await $.store.get('agents').catch(() => undefined)) ?? []) as MadeAgent[]
    await $.store.set('agents', [...made.filter(m => m.name !== name), spec])
    await set($, s => ({
      custom: [...s.custom.filter(c => c.type !== reg.agent), { type: reg.agent, name: expertName(reg.agent), what: spec.description }],
      agentTypes: s.agentTypes.includes(reg.agent) ? s.agentTypes : [...s.agentTypes, reg.agent],
      ui: { ...s.ui, describe: '', spawnOpen: false },
    }))
    await toast($, `Made the ${expertName(reg.agent)} agent: it is on the team board, and ▶ runs it from your next prompt on`)
  } catch (e) {
    await toast($, `Could not make the agent: ${String(e)}`)
  } finally {
    await set($, { creating: '' })
  }
}

// An expert's brief: the task, the files touched, and the reports of the experts before it
function expertPrompt(s: Ph, prior: string[]) {
  const touched = [...new Set(s.ops.filter(o => o.op === 'Write' || o.op === 'Edit').map(o => o.path))].slice(-12)
  // From the codebase memory: the files that import what changed, which the change reaches too
  const by = importers(s.memory.files)
  const keys = touched.map(p => memoryKey(s.memory.files, p)).filter(Boolean)
  const reach = [...new Set(keys.flatMap(k => by[k] ?? []))].filter(f => !keys.includes(f)).slice(0, 20)
  // Agent memory: what earlier runs on a task like this found, so this one starts from it rather than from nothing
  const recall = similarRuns(s.task, [...s.pastAgents, ...s.agents]).map(x => `- the ${x.run.name}, on "${x.run.task.slice(0, 100)}": ${recallOf(x.run) || 'no report'}`)
  return `Task: ${s.task || '(see the git diff)'}\nChanged files: ${touched.join(', ') || '(see git diff)'}${reach.length ? `\nAlso affected (they import the changed files): ${reach.join(', ')}` : ''}${recall.length ? `\n\nREMEMBERED (earlier runs on similar tasks; check they still hold, do not trust them blindly):\n${recall.join('\n')}` : ''}\n\nPRIOR REPORTS:\n${prior.length ? prior.map((r, i) => `--- ${i + 1} ---\n${r}`).join('\n\n') : '(none: you are first)'}`
}

// Starts one expert; returns its agent id ('' when the start handed none back: the agent.spawn hook records it), or null when refused
// Prompts Cockpit sends to hand a refused start to Claude: they open no flow and write no steps of their own
// The lines Cockpit sends to hand an agent start to Claude: they open no flow
export const handoffs = new Set<string>()
let handoffSeq = 0

// Auto mode judges a subagent by the request to the model that asked for it, and a press in the pane is none, so it
// refuses with "no verdict". The start then goes to Claude as one short line in the conversation, and Claude starts the
// agent in that turn (auto mode judges it like any agent Claude starts); the agent.spawn hook tracks it and binds it to a
// waiting pipeline step. The brief rides in a file the line names (in .cockpit/, kept out of git), so it arrives even
// where another plugin's hook keeps Cockpit's own prompt hooks from running; inline where no file can be written.
// It never waits for that turn: a press, a command and a turn's end all return at once
export async function handOff($: $, items: { type: string; brief: string }[]) {
  if (!items.length) return false
  const dir = await cockpitDir($)
  // ponytail: one small file a hand-off, never pruned; .cockpit/ is git-ignored
  const parts = await Promise.all(
    items.map(async ({ type, brief }) => {
      const file = dir ? `${dir}/handoffs/${type.replace(/[^a-z0-9]+/gi, '-')}-${await $.clock.now()}-${++handoffSeq}.md` : ''
      const wrote = !!file && (await $.fs.write(file, brief).then(() => true).catch(() => false))
      return { type, brief, file: wrote ? file : '' }
    }),
  )
  const name = parts.length === 1 ? expertName(parts[0]!.type) : `${parts.length} agents`
  const one = parts[0]!
  const text =
    parts.length === 1
      ? one.file
        ? `▶ Start the ${name}: run the ${one.type} agent in the background; its brief is in ${one.file}`
        : `▶ Start the ${name}: run the ${one.type} agent in the background with this brief:\n\n${one.brief}`
      : `▶ Start ${name}: run each in the background, all at once, each with its own brief:\n${parts.map(p => (p.file ? `- ${p.type}: brief in ${p.file}` : `- ${p.type}, with this brief:\n${p.brief}`)).join('\n')}`
  handoffs.add(text)
  const failed = async () => {
    handoffs.delete(text)
    await note($, `⧉ ${name} could not start: ${parts.length === 1 ? 'it' : 'they'} could not be handed to Claude`)
  }
  const send = async () => {
    const r = await $.prompt.submit({ text })
    if ('drop' in r && r.drop) await failed()
  }
  await toast($, `Starting ${parts.length === 1 ? `the ${name.toLowerCase()}` : name}…`)
  // Where the engine refuses the prompt from here (inside a command's hook, which holds the turn it would wait on), it
  // goes from a timer once that hook has returned
  void send().catch(() => {
    try {
      $.clock.after(20, () => {
        void send().catch(() => failed())
      })
    } catch {
      void failed()
    }
  })
  return true
}

export async function runExpert($: $, type: string, prior: string[] = [], opts: { task?: string; batch?: { type: string; brief: string }[]; inTree?: boolean } = {}) {
  const s0 = await read($, S)
  const s = opts.task ? { ...s0, task: opts.task } : s0
  const name = expertName(type)
  await set($, { starting: { name, type, task: s.task || name, ...(s.ui.agentWorktree && !opts.inTree ? { worktree: true } : {}) } })
  const wt = opts.inTree ? null : await worktreeToRun($, type)
  if (wt && 'twin' in wt) await set($, st => ({ starting: st.starting ? { ...st.starting, type: wt.twin } : null }))
  const r = await startAgent($, { prompt: expertPrompt(s, prior), description: name, type: wt && 'twin' in wt ? wt.twin : type, ...(wt && 'own' in wt ? { cwd: wt.own.path } : {}) })
  await set($, { starting: null })
  await keepWorktree($, 'deny' in r ? null : (r.agentId ?? ''), wt)
  if ('deny' in r) {
    // Refused for want of a request: Claude starts it instead; '' keeps a pipeline waiting on this step
    if (/no verdict/i.test(r.deny ?? '')) {
      if (opts.batch) return (opts.batch.push({ type, brief: expertPrompt(s, prior) }), '')
      if (await handOff($, [{ type, brief: expertPrompt(s, prior) }])) return ''
    }
    // In the chat too: a toast is gone in seconds and never reaches the transcript
    await note($, `⧉ ${name} could not start: ${r.deny}`)
    await toast($, `${name} could not start: ${r.deny}`)
    return null
  }
  if (r.agentId) await trackAgent($, { id: r.agentId, name, type, task: s.task || name, prompt: expertPrompt(s, prior) })
  await toast($, `Started the ${name.toLowerCase()}`)
  return r.agentId
}

// A start in flight: a second press while the first expert is still being spawned is refused, not doubled
let startingPipeline = false

// A pipeline: the experts in turn, each handed the reports so far
export async function startPipeline($: $, name: string, opts: { for?: string; prior?: string[] } = {}) {
  const def = PIPELINES.find(p => p.name === name)
  if (!def) return
  const s = await read($, S)
  // A pipeline whose expert never got an id (nothing can ever finish it) is stale and gives way
  if (startingPipeline || s.pipeline?.agentId) return toast($, `${PIPELINES.find(p => p.name === s.pipeline?.name)?.label ?? 'A pipeline'} is still running`)
  startingPipeline = true
  try {
    const at = await $.clock.now()
    await set($, st => ({
      pipeline: { name, steps: def.steps, index: 0, agentId: '', reports: opts.prior ?? [], at, ...(opts.for ? { for: opts.for } : {}) },
      // Verify counts toward the flow it tests: the last one, running or just closed; before any prompt there is none
      ...(st.flows.length ? { reached: st.reached.includes('Verify') ? st.reached : [...st.reached, 'Verify'] } : {}),
      flows: st.flows.map((f, i) => (i === st.flows.length - 1 && !f.reached.includes('Verify') ? { ...f, reached: [...f.reached, 'Verify'] } : f)),
    }))
    // A pipeline's experts hand their work on through your tree: never a worktree of their own
    await bindExpert($, await runExpert($, def.steps[0] ?? '', opts.prior ?? [], { inTree: true }))
  } finally {
    startingPipeline = false
  }
}

// The started expert's id on the pipeline: the call's, else the one the agent.spawn hook recorded; a refusal ends the pipeline
async function bindExpert($: $, id: string | null) {
  if (id === null) return set($, { pipeline: null })
  await set($, st => (st.pipeline ? { pipeline: { ...st.pipeline, agentId: st.pipeline.agentId || id } } : {}))
}

// The agent that just finished was the pipeline's: keep its report and start the next expert, or finish
export async function advancePipeline($: $, agentId: string, answer: string, aborted = false) {
  const s = await read($, S)
  const p = s.pipeline
  if (!p || p.agentId !== agentId) return
  if (aborted) {
    await set($, { pipeline: null })
    return toast($, `${PIPELINES.find(x => x.name === p.name)?.label ?? p.name} pipeline stopped: the ${expertName(p.steps[p.index] ?? '').toLowerCase()} was stopped`)
  }
  const reports = [...p.reports, `${expertName(p.steps[p.index] ?? '')}:\n${parseReport(answer)}`]
  const index = p.index + 1
  const next = p.steps[index]
  if (!next) {
    await set($, { pipeline: null })
    const label = PIPELINES.find(x => x.name === p.name)?.label ?? p.name
    await toast($, `${label} pipeline done`)
    await note($, `⧉ ${label} pipeline done · ${reports.length} experts`)
    const after = await read($, S)
    if (p.name === 'verify' && after.git.commitMode !== 'manual' && after.git.autoWhen === 'tests' && verifyState(after.agents).passed) {
      // The testers may have written files since the turn's end read the repository
      await refreshRepo($)
      await decideCommit($)
    }
    return
  }
  await set($, { pipeline: { ...p, index, reports, agentId: '' } })
  await bindExpert($, await runExpert($, next, reports, { inTree: true }))
}

// An agent's answer arrived: its cases and report go on its record
export async function finishAgent($: $, agentId: string, answer: string, aborted: boolean, failed = false) {
  const at = await $.clock.now()
  const cases = parseCases(answer)
  const report = parseReport(answer)
  await set($, s => ({ agents: s.agents.map(a => (a.id === agentId && (a.status === 'running' || (a.status !== 'stopped' && !a.report && !a.cases.length)) ? { ...a, status: aborted ? 'stopped' : failed ? 'failed' : 'done', endedAt: at, cases, report, log: [...a.log, { at, t: failed ? 'Failed · the run ended on an error' : 'Done · report ready' }] } : a)) }))
  const a = (await read($, S)).agents.find(x => x.id === agentId)
  if (a && cases.length) {
    const fail = cases.filter(c => c.st === 'fail').length
    await toast($, `${a.name}: ${cases.length - fail}/${cases.length} passed${fail ? ` · ${fail} failing` : ''}`)
    await note($, `${fail ? '✗' : '✓'} ${a.name} · ${cases.length - fail}/${cases.length} passed${fail ? ` · ${fail} failing` : ''}`)
  }
}

// A subagent's task list that came before its row (its first plan call can beat the spawn's record): the row takes it
export const earlyPlans = new Map<string, PlanItem[]>()
const takeEarly = (id: string) => {
  const p = earlyPlans.get(id)
  earlyPlans.delete(id)
  return p ? { plan: p } : {}
}

export async function trackAgent($: $, a: Pick<Agent, 'id' | 'name' | 'type' | 'task' | 'prompt'> & Partial<Pick<Agent, 'by' | 'parent' | 'provider'>> & { cwd?: string }) {
  const at = await $.clock.now()
  // Started twice (our own spawn, then its agent.spawn event): keep the first record's log and count.
  // A tester a Verify pipeline started on an agent's work is tagged with that agent
  await set($, s => {
    const was = s.agents.find(x => x.id === a.id)
    const p = s.pipeline
    const tests = was?.for ?? (p?.for && p.steps[p.index] === a.type ? p.for : undefined)
    if (a.cwd) spawnedIn.set(slashed(a.cwd), a.id)
    const key = pendingWorktrees.has(a.id) ? a.id : a.cwd && pendingWorktrees.has(slashed(a.cwd)) ? slashed(a.cwd) : pendingWorktrees.has(`type:${a.type}`) ? `type:${a.type}` : ''
    const wt = key ? pendingWorktrees.get(key) : undefined
    if (key) pendingWorktrees.delete(key)
    return { agents: [...s.agents.filter(x => x.id !== a.id), { ...takeEarly(a.id), ...(wt ? { worktree: wt } : {}), ...was, ...(({ cwd: _c, ...rest }) => rest)(a), status: was && was.status !== 'running' ? was.status : ('running' as const), startedAt: was?.startedAt ?? at, tools: was?.tools ?? 0, log: was?.log ?? [], cases: was?.cases ?? [], report: was?.report ?? '', ...(tests ? { for: tests } : {}) }].slice(-40) }
  })
}

// The positive and the negative tester
export const TESTERS = ['cockpit:prover', 'cockpit:breaker']
// A run that wrote or edited a file
export const changedFiles = (a: Agent) => a.log.some(l => /^(Edit|Write|NotebookEdit|MultiEdit) /.test(l.t))

// Tests an agent's run: the Verify pipeline (the Prover proves it works, then the Breaker tries to break it), briefed
// with what that agent was asked and reported. auto: after a run that changed files, while the setting is on, and
// never on a tester's own run or while another pipeline runs
export async function testAgent($: $, id: string, auto: boolean) {
  const s = await read($, S)
  const a = s.agents.find(x => x.id === id)
  if (!a || a.status !== 'done' || TESTERS.includes(a.type)) return
  if (auto && (!s.testAgents || !changedFiles(a) || s.pipeline)) return
  const prior = [`${a.name} (the agent whose work you are testing):\nIts task: ${a.task}\n${a.report || '(it left no report: read the files it changed)'}`]
  await startPipeline($, 'verify', { for: id, prior })
}

// Agent types the model can dispatch: the built-ins, the project's and your own agents/*.md, each installed plugin's as <plugin>:<name>, and any type seen starting
export async function discoverAgentTypes($: $) {
  const names = async (dir: string) => (await $.fs.list(dir).catch(() => [])).filter(e => e.name.endsWith('.md')).map(e => e.name.slice(0, -3))
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
  const found = [...(await names('.claude/agents')), ...(home ? await names(`${home}/.claude/agents`) : [])]
  if (home) {
    const cache = `${home}/.claude/plugins/cache`
    for (const mk of await $.fs.list(cache).catch(() => [])) {
      for (const pl of await $.fs.list(`${cache}/${mk.name}`).catch(() => [])) {
        for (const ver of await $.fs.list(`${cache}/${mk.name}/${pl.name}`).catch(() => [])) {
          for (const n of await names(`${cache}/${mk.name}/${pl.name}/${ver.name}/agents`)) found.push(`${pl.name}:${n}`)
        }
      }
    }
  }
  await set($, s => ({ agentTypes: [...new Set([...AGENT_TYPES, ...s.agentTypes, ...found, ...s.agents.map(a => a.type)])] }))
}

export async function spawnAgent($: $, task: string, type: string) {
  await set($, s => ({ starting: { name: expertName(type) === type && type === 'general-purpose' ? 'Agent' : expertName(type), type, task, ...(s.ui.agentWorktree ? { worktree: true } : {}) } }))
  const wt = await worktreeToRun($, type)
  if (wt && 'twin' in wt) await set($, st => ({ starting: st.starting ? { ...st.starting, type: wt.twin } : null }))
  const r = await startAgent($, { prompt: task, description: task.slice(0, 60), type: wt && 'twin' in wt ? wt.twin : type, ...(wt && 'own' in wt ? { cwd: wt.own.path } : {}) })
  await set($, { starting: null })
  await keepWorktree($, 'deny' in r ? null : (r.agentId ?? ''), wt)
  if ('deny' in r) {
    if (/no verdict/i.test(r.deny ?? '') && (await handOff($, [{ type, brief: task }]))) return set($, s => ({ ui: { ...s.ui, spawnOpen: false, spawnTask: '' } }))
    await note($, `⧉ ${type} could not start: ${r.deny}`)
    return toast($, `Could not start the agent: ${r.deny}`)
  }
  if (r.agentId) await trackAgent($, { id: r.agentId, name: type === 'general-purpose' ? 'Agent' : type, type, task, prompt: task })
  await set($, s => ({ ui: { ...s.ui, spawnOpen: false, spawnTask: '', openAgent: r.agentId } }))
  await toast($, `Started ${type}`)
}

// Several agents at once, each a run of its own with the same task (the current one where none is given); where auto
// mode refuses them for want of a request, they go to Claude together, in one line
export async function runMany($: $, types: string[], task = '') {
  if (!types.length) return toast($, 'Tick the agents to run first')
  const batch: { type: string; brief: string }[] = []
  for (const type of types) await runExpert($, type, [], { ...(task ? { task } : {}), batch })
  await handOff($, batch)
  await set($, s => ({ ui: { ...s.ui, selected: {}, runTask: '' } }))
}

// The context window, made room in: Compact keeps a summary in the conversation's place (as /compact does), Clear starts
// the conversation afresh (as /clear does; the transcript stays in your history). Both wait for the session to be idle
export async function compactNow($: $) {
  const r = await $.session.compact({}).catch(e => ({ skip: String(e).includes('turn') ? 'a turn is running: try again when it ends' : String(e) }))
  await toast($, 'skip' in r && r.skip ? `Not compacted: ${r.skip}` : 'Compacted: a summary keeps the conversation')
  await measure($)
}
export async function clearNow($: $) {
  await set($, s => ({ ui: { ...s.ui, confirmClear: false } }))
  const r = await $.command.run({ command: 'clear' }).catch(e => ({ text: `Could not clear: ${String(e)}` }))
  await toast($, 'text' in r && r.text?.startsWith('Could not') ? r.text : 'Context cleared')
  await measure($)
}

// The session's agents as the engine lists them, Claude's subagents included: one Cockpit never heard start (another
// plugin's hook can run before its own) joins the Agents tab, and one it never heard end is settled
export async function syncAgents($: $) {
  const list = await $.agent.list().catch(() => null)
  if (!list?.length) return
  const at = await $.clock.now()
  await set($, s => {
    let agents = s.agents
    for (const a of list) {
      // Cleared from the list by you: the engine still lists it, and it stays cleared
      if (s.cleared.includes(a.id)) continue
      const st = a.status === 'completed' ? 'done' : a.status === 'failed' ? 'failed' : a.status === 'killed' ? 'stopped' : 'running'
      const was = agents.find(x => x.id === a.id)
      const name = expertName(a.type) !== a.type ? expertName(a.type) : a.description || a.type
      if (!was) agents = [...agents, { ...takeEarly(a.id), id: a.id, name, type: a.type, task: a.description, prompt: '', status: st, startedAt: at, ...(st !== 'running' ? { endedAt: at } : {}), tools: 0, log: [], cases: [], report: '' }]
      else if (was.status === 'running' && st !== 'running') agents = agents.map(x => (x.id === a.id ? { ...x, status: st, endedAt: at } : x))
    }
    return agents === s.agents ? {} : { agents: agents.slice(-40) }
  })
}

// An agent run again with your instructions: a run's own brief with them added, or a team agent with them as its task
export async function rerun($: $, target: string, text: string) {
  const s = await read($, S)
  const said = text.trim()
  await set($, st => ({ ui: { ...st.ui, rerunFor: '', rerunText: '' } }))
  if (target.startsWith('type:')) return runExpert($, target.slice(5), [], said ? { task: said } : {})
  const a = s.agents.find(x => x.id === target)
  if (!a) return
  const known = EXPERTS.some(x => x.type === a.type) || s.custom.some(c => c.type === a.type)
  if (known) return runExpert($, a.type, [], { task: said ? `${a.task}\n\nInstructions for this run: ${said}` : a.task })
  return spawnAgent($, said ? `${a.prompt || a.task}\n\nInstructions for this run: ${said}` : a.prompt || a.task, a.type)
}

// Every running agent, stopped
export async function stopAll($: $) {
  const live = (await read($, S)).agents.filter(a => a.status === 'running')
  for (const a of live) await stopAgent($, a.id, true)
  await toast($, live.length ? `Stopped ${live.length} agent${live.length === 1 ? '' : 's'}` : 'Nothing running')
}

// The finished runs off the list; they stay in .cockpit/history.json
export async function clearFinished($: $) {
  await saveHistory($)
  const at = await $.clock.now()
  await set($, s => ({
    cleared: [...s.cleared, ...s.agents.filter(a => a.status !== 'running').map(a => a.id)].slice(-300),
    clearedAt: at,
    agents: s.agents.filter(a => a.status === 'running'),
    // saveHistory writes the file from pastAgents and agents: the cleared runs stay there
    pastAgents: [...s.pastAgents.filter(p => !s.agents.some(a => a.id === p.id)), ...s.agents.filter(a => a.status !== 'running').map(summary)],
    ui: { ...s.ui, openAgent: '' },
  }))
}

export async function stopAgent($: $, id: string, quiet = false) {
  const r = await $.tool.call({ tool: 'TaskStop', task_id: id, consent: 'The user pressed "Stop" on an agent in the Cockpit pane' }).catch(e => ({ deny: String(e) }))
  const ok = !('deny' in r && r.deny) && !('isError' in r && r.isError)
  const at = await $.clock.now()
  if (ok) await set($, s => ({ agents: s.agents.map(a => (a.id === id && a.status === 'running' ? { ...a, status: 'stopped', endedAt: at, log: [...a.log, { at, t: 'Stopped by you' }] } : a)), pipeline: s.pipeline?.agentId === id ? null : s.pipeline }))
  if (!quiet || !ok) await toast($, ok ? 'Stopped the agent' : `Could not stop it: ${'deny' in r && r.deny ? r.deny : ('text' in r && r.text) || ''}`)
}

// Refresh context fill, its breakdown and cost
export async function measure($: $) {
  const u = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  if (!u) return
  const cats = (u.context.breakdown?.categories ?? []).filter(c => c.tokens > 0 && !/free|buffer/i.test(c.name))
  const segs = cats
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 4)
    .map(c => [c.name, c.tokens] as [string, number])
  // Before the first API response `tokens` is unset: the breakdown's total stands in
  const used = u.context.tokens ?? u.context.breakdown?.totalTokens ?? 0
  const pct = u.context.percent ?? (u.context.window ? Math.round((used / u.context.window) * 100) : 0)
  await set($, {
    ctx: { pct, used, window: u.context.window, segs },
    cost: u.cost?.usd ?? 0,
  })
}

// Claude Code's own worktree isolation lives on an agent's definition (`isolation: 'worktree'`), not on a start: so for
// each type Cockpit defines (its experts, the agents you made, a general-purpose one) it registers a twin that runs
// isolated, and a ticked start of that type starts the twin. Claude Code then makes the worktree; Cockpit finds it
export const isolatedTwin = new Map<string, string>()
async function registerIsolated($: $, type: string, spec: { name: string; description: string; prompt: string; model?: string; tools?: readonly string[] }) {
  const r = await $.agent.register({ ...spec, name: `${spec.name}-in-worktree`, description: `${spec.description} (in a worktree of its own)`, isolation: 'worktree' }).catch(() => null)
  if (r?.agent) isolatedTwin.set(type, r.agent)
}

// With "In its own worktree" ticked, the worktree an agent starts in: made from HEAD on a branch of its own; none (and
// a toast saying why) when it cannot be, so the agent runs in your tree. The id is the time and a count, never reused
let worktrees = 0
type Plan = { own: { path: string; branch: string; base: string } } | { twin: string; base: string; before: string[] } | null
async function worktreeToRun($: $, type: string): Promise<Plan> {
  if (!(await read($, S)).ui.agentWorktree) return null
  // Claude Code's own isolation, through the type's isolated twin
  const twin = isolatedTwin.get(type)
  if (twin) {
    const b = await beforeIsolated($)
    if (b) return { twin, ...b }
    await toast($, 'Runs in your tree: the repository has no commit yet')
    return null
  }
  // A type Cockpit cannot redefine (another plugin's): a worktree Cockpit makes itself
  const wt = await makeWorktree($, `ag${await $.clock.now()}-${++worktrees}`).catch(e => ({ error: String(e) }))
  if ('error' in wt) {
    await toast($, `Runs in your tree: ${wt.error}`)
    return null
  }
  return { own: wt }
}
// The agent it started for keeps it: by id, or, where the start hands no id back, by the folder its spawn event names;
// one whose record is not made yet gets it when it is. A start that was refused (null), or handed to Claude (who starts
// it in your tree), leaves no worktree or branch behind
const pendingWorktrees = new Map<string, NonNullable<Agent['worktree']>>()
// A twin's worktree, made by Claude Code: nothing to undo on a refusal; otherwise the agent waits to have it found
async function keepIsolated($: $, id: string | null, plan: { twin: string; base: string; before: string[] }) {
  if (id === null) return
  const w = { path: '', branch: '', base: plan.base, claude: true, before: plan.before }
  // A start that hands no id back: the twin's spawn event, by its type, picks it up
  if (!id) return void pendingWorktrees.set(`type:${plan.twin}`, w)
  if ((await read($, S)).agents.some(a => a.id === id)) await set($, s => ({ agents: s.agents.map(a => (a.id === id ? { ...a, worktree: w } : a)) }))
  else pendingWorktrees.set(id, w)
  await findIsolated($, id).catch(() => null)
}
// The folder each agent's spawn event named, for a worktree whose start handed no id back but whose event came first
const spawnedIn = new Map<string, string>()
const slashed = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
async function keepWorktree($: $, id: string | null, plan: Plan) {
  if (!plan) return
  if ('twin' in plan) return keepIsolated($, id, plan)
  const wt = plan.own
  if (id === null) return dropWorktree($, wt)
  const owner = id || spawnedIn.get(slashed(wt.path)) || ''
  if (owner && (await read($, S)).agents.some(a => a.id === owner)) await set($, s => ({ agents: s.agents.map(a => (a.id === owner ? { ...a, worktree: wt } : a)) }))
  else pendingWorktrees.set(owner || slashed(wt.path), wt)
}
