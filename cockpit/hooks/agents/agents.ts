import type { AgentSpawnInput } from 'claude-code'
import type { Agent, FileOp, Ph, PlanItem } from '../../types'
import type { $ } from '../core/core'
import { set, look, toast, note, homeDir, submitPrompt } from '../core/core'
import { saveHistory, summary } from '../core/history'
import { tellDone } from '../core/notify'
import { cockpitDir } from '../core/repos'
import { plural } from '../core/text'
import { refreshRepo, decideCommit } from '../git/git'
import { importers, memoryKey } from '../memory/memory'
import { updateMemory } from '../memory/memory-io'
import { expertName, agentName, EXPERTS, similarRuns, recallOf, PIPELINES, parseReport, reportPart, verifyState, parseCases, AGENT_TYPES, TESTERS, shortType, passedOf } from '../core/experts'
import { pickRun, pickLabel } from './pick'
import { plainType, twinSpec, registerIsolated, worktreeToRun, keepWorktree, takeWorktree, measureWorktree } from './worktrees-io'
import { EDIT_TOOLS } from '../flows/tools'

// The agents the Agents tab keeps, and the early plans held for agents with no row yet
const AGENTS_KEPT = 40

// Spawns started from the pane right now, each its type and exact prompt: the tool.check hook puts these to the person
const ownStarts: { type: string; prompt: string }[] = []
export function isOwnStart(input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>
  return ownStarts.some(o => o.type === (i.subagent_type ?? 'general-purpose') && o.prompt === i.prompt)
}

// Starts a subagent in the background and settles once it has started, with its id
async function startAgent($: $, a: { prompt: string; description: string; type: string; cwd?: string; pick?: ReturnType<typeof pickRun> }) {
  const own = { type: a.type, prompt: a.prompt }
  ownStarts.push(own)
  // The spawn takes a model; effort belongs to the agent's definition, so a known expert is registered again with the pick's
  // ponytail: a run started at the same moment as another of its type can take the other's effort; per-run effort needs a spawn field
  const plain = plainType(a.type)
  const spec = a.pick && specs.get(shortType(plain))
  if (spec && a.pick) await $.agent.register({ ...(plain === a.type ? spec : twinSpec(spec)), model: a.pick.model, effort: a.pick.effort }).catch(() => null)
  const r = await $.agent.spawn({ prompt: a.prompt, description: a.description, subagentType: a.type, ...(a.cwd ? { cwd: a.cwd } : {}), ...(a.pick ? { model: a.pick.model } : {}) })
    .catch(e => ({ deny: String(e) }))
    .finally(() => ownStarts.splice(ownStarts.indexOf(own), 1))
  if ('deny' in r && r.deny) return { deny: r.deny }
  return { agentId: 'agentId' in r && r.agentId ? r.agentId : '' }
}

// The experts' definitions from agents/*.md, by name: startAgent registers one again with the picked effort
const specs = new Map<string, { name: string; description: string; prompt: string; model?: string; tools?: string[] }>()

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
    specs.set(name, spec)
    const r = await $.agent.register(spec).catch(e => ($.ui.log(`cockpit: could not register the ${spec.name}: ${String(e)}`), null))
    if (r?.agent) await registerIsolated($, r.agent, spec)
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

const PLAN_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate']
// What every agent Cockpit makes is told, as the experts' own files say it
const AGENT_RULES = 'Keep a short task list with your todo tool (TodoWrite, or TaskCreate and TaskUpdate): three to six steps, each marked in progress when you start it and completed when it is done. Cockpit shows it as your progress.\n\nNever commit, push, switch branches or stash: Cockpit handles git. Never write to .cockpit/ (reading .cockpit/roadmap.md is fine).'
type MadeAgent = { name: string; description: string; prompt: string; tools?: string[] }
// The tools a made agent may be given
const TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch']

// An agent from the person's own words: a model writes its definition, Cockpit registers it as cockpit:<name>
// (runnable at once, here and by Claude) and keeps it in the store for later sessions
export async function createAgent($: $, describe: string) {
  if ((await look($)).creating) return toast($, 'Still making the last agent')
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
    if (EXPERTS.some(x => shortType(x.type) === name)) return toast($, `"${name}" is one of Cockpit's own experts: describe it differently`)
    const tools = (Array.isArray(raw.tools) ? raw.tools : []).filter(t => TOOLS.includes(t))
    // Every agent keeps a task list Cockpit can track, and leaves git to Cockpit, as the experts do
    const spec: MadeAgent = { name, description: String(raw.description), prompt: `${String(raw.prompt).trim()}\n\n${AGENT_RULES}`, ...(tools.length ? { tools: [...new Set([...tools, ...PLAN_TOOLS])] } : {}) }
    const reg = await $.agent.register(spec).catch(e => ({ deny: String(e) }))
    if ('deny' in reg) return toast($, `Could not register the agent: ${reg.deny}`)
    // Its twin too, so it can run in a worktree of its own this session
    await registerIsolated($, reg.agent, spec)
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

// The prompts Cockpit sends to hand a refused start to Claude: the prompt.submit hook opens no flow and writes no
// steps for one, and turn.start takes it off
const handoffs = new Set<string>()
export function isHandoff(text: string) {
  return handoffs.has(text)
}
export function takeHandoff(text: string) {
  return handoffs.delete(text)
}
// Numbers the hand-offs' brief files
let handoffSeq = 0

// Auto mode judges a subagent by the request to the model that asked for it, and a press in the pane is none, so it
// refuses with "no verdict". The start then goes to Claude as one short line in the conversation, and Claude starts the
// agent in that turn (auto mode judges it like any agent Claude starts); the agent.spawn hook tracks it and binds it to a
// waiting pipeline step. The brief rides in a file the line names (in .cockpit/, kept out of git), so it arrives even
// where another plugin's hook keeps Cockpit's own prompt hooks from running; inline where no file can be written.
// It never waits for that turn: a press, a command and a turn's end all return at once
async function handOff($: $, items: { type: string; brief: string }[]) {
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
  await toast($, `Starting ${parts.length === 1 ? `the ${name.toLowerCase()}` : name}…`)
  submitPrompt($, text, async () => {
    handoffs.delete(text)
    await note($, `⧉ ${name} could not start: ${parts.length === 1 ? 'it' : 'they'} could not be handed to Claude`)
  })
  return true
}

// An agent's start with the worktree planned for it: a twin's type shown while it starts, the worktree kept by the
// agent or dropped on a refusal, and a twin's one-at-a-time turn given back whatever happens
async function startIn($: $, wt: Awaited<ReturnType<typeof worktreeToRun>>, a: Parameters<typeof startAgent>[1]) {
  try {
    if (wt && 'twin' in wt) await set($, st => ({ starting: st.starting ? { ...st.starting, type: wt.twin } : null }))
    const r = await startAgent($, { ...a, type: wt && 'twin' in wt ? wt.twin : a.type, ...(wt && 'own' in wt ? { cwd: wt.own.path } : {}) })
    await set($, { starting: null })
    await keepWorktree($, 'deny' in r ? null : (r.agentId ?? ''), wt)
    return r
  } finally {
    if (wt && 'twin' in wt) wt.release()
  }
}

// Starts one expert; returns its agent id ('' when the start handed none back: the agent.spawn hook records it), or
// null when refused. batch: where auto mode refuses the start, its brief is added there for the caller to hand to
// Claude with the others, instead of being handed over alone
export async function runExpert($: $, type: string, prior: string[] = [], opts: { task?: string; batch?: { type: string; brief: string }[]; inTree?: boolean } = {}) {
  const s0 = await look($)
  const s = opts.task ? { ...s0, task: opts.task } : s0
  const name = agentName(type)
  const pick = s.chooseModel ? pickRun(s.task, type, new Set(s.ops.filter(o => o.op === 'Write' || o.op === 'Edit').map(o => o.path)).size) : undefined
  await set($, { starting: { name, type, task: s.task || name, ...(pick ? { pick: pickLabel(pick) } : {}) } })
  const brief = expertPrompt(s, prior)
  const wt = opts.inTree ? null : await worktreeToRun($, type)
  const r = await startIn($, wt, { prompt: brief, description: name, type, ...(pick ? { pick } : {}) })
  if ('deny' in r) {
    // Refused for want of a request: Claude starts it instead; '' keeps a pipeline waiting on this step
    if (/no verdict/i.test(r.deny ?? '')) {
      if (opts.batch) return (opts.batch.push({ type, brief }), '')
      if (await handOff($, [{ type, brief }])) return ''
    }
    // In the chat too: a toast is gone in seconds and never reaches the transcript
    await note($, `⧉ ${name} could not start: ${r.deny}`)
    await toast($, `${name} could not start: ${r.deny}`)
    return null
  }
  if (r.agentId) await trackAgent($, { id: r.agentId, name, type, task: s.task || name, prompt: brief, ...(pick ? { pick: pickLabel(pick) } : {}) })
  await toast($, `Started the ${name.toLowerCase()}`)
  return r.agentId
}

// A start in flight: a second press while the first expert is still being spawned is refused, not doubled
let startingPipeline = false

// A pipeline: the experts in turn, each handed the reports so far
export async function startPipeline($: $, name: string, opts: { for?: string; prior?: string[] } = {}) {
  const def = PIPELINES.find(p => p.name === name)
  if (!def) return
  const s = await look($)
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
async function advancePipeline($: $, agentId: string, answer: string, aborted: boolean) {
  const s = await look($)
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
    const after = await look($)
    // A notice while you are not watching: passed, or the first case that failed
    const vs = verifyState(after.agents)
    // The first failing case of this run's testers (the latest Prover and Breaker), never an older run's
    const failing = vs.cases.find(c => c.st === 'fail')
    await tellDone($, `pipeline:${p.name}:${p.at}:${agentId}`, { kind: 'pipeline', label, passed: p.name === 'verify' ? vs.passed : true, ...(failing ? { failing: failing.n } : {}) })
    if (p.name === 'verify' && after.git.commitMode !== 'manual' && after.git.autoWhen === 'tests' && vs.passed) {
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
async function finishAgent($: $, agentId: string, answer: string, aborted: boolean, failed: boolean) {
  const at = await $.clock.now()
  const cases = parseCases(answer)
  const report = parseReport(answer)
  await set($, s => ({ agents: s.agents.map(a => (a.id === agentId && (a.status === 'running' || (a.status !== 'stopped' && !a.report && !a.cases.length)) ? { ...a, status: aborted ? 'stopped' : failed ? 'failed' : 'done', endedAt: at, cases, report, log: [...a.log, { at, t: failed ? 'Failed · the run ended on an error' : 'Done · report ready' }] } : a)) }))
  const a = (await look($)).agents.find(x => x.id === agentId)
  if (a && cases.length) {
    const fail = cases.filter(c => c.st === 'fail').length
    await toast($, `${a.name}: ${passedOf(cases)}/${cases.length} passed${fail ? ` · ${fail} failing` : ''}`)
    await note($, `${fail ? '✗' : '✓'} ${a.name} · ${passedOf(cases)}/${cases.length} passed${fail ? ` · ${fail} failing` : ''}`)
  }
}

// A subagent's task list that came before its row (its first plan call can beat the spawn's record): the row takes it
const earlyPlans = new Map<string, PlanItem[]>()
export function holdEarlyPlan(id: string, change: (plan: PlanItem[]) => PlanItem[]) {
  // ponytail: ids that never get a row are held to the last 40
  if (earlyPlans.size >= AGENTS_KEPT && !earlyPlans.has(id)) earlyPlans.delete(earlyPlans.keys().next().value!)
  earlyPlans.set(id, change(earlyPlans.get(id) ?? []))
}
const takeEarly = (id: string) => {
  const p = earlyPlans.get(id)
  earlyPlans.delete(id)
  return p ? { plan: p } : {}
}

async function trackAgent($: $, a: Pick<Agent, 'id' | 'name' | 'type' | 'task' | 'prompt'> & Partial<Pick<Agent, 'by' | 'parent' | 'provider'>> & { cwd?: string }) {
  const at = await $.clock.now()
  // Its worktree, if one waits for it: taken here, once, outside the state's update
  const isNew = !(await look($)).agents.some(x => x.id === a.id)
  const wt = takeWorktree(a, isNew)
  const plain = plainType(a.type)
  // Started twice (our own spawn, then its agent.spawn event): keep the first record's log and count.
  // A tester a Verify pipeline started on an agent's work is tagged with that agent
  await set($, s => {
    const was = s.agents.find(x => x.id === a.id)
    const p = s.pipeline
    const tests = was?.for ?? (p?.for && p.steps[p.index] === plain ? p.for : undefined)
    a = { ...a, type: plain }
    return { agents: [...s.agents.filter(x => x.id !== a.id), { ...takeEarly(a.id), ...(wt ? { worktree: wt } : {}), ...was, ...(({ cwd: _c, ...rest }) => rest)(a), status: was && was.status !== 'running' ? was.status : ('running' as const), startedAt: was?.startedAt ?? at, tools: was?.tools ?? 0, log: was?.log ?? [], cases: was?.cases ?? [], report: was?.report ?? '', ...(tests ? { for: tests } : {}) }].slice(-AGENTS_KEPT) }
  })
}

// A subagent started, whoever started it: it gets its row in the Agents tab, and a pipeline step waiting for it gets its id
export async function agentSpawned($: $, id: string, e: AgentSpawnInput) {
  const s0 = await look($)
  // One Cockpit started itself is named by its note; the model's by the event. A row already there keeps its name
  // (the event can come after the start that made the row)
  // (the note stands while Cockpit's start waits, so a spawn of another type then is the model's, not that one)
  const own = s0.starting && (!e.subagentType || e.subagentType === s0.starting.type) ? s0.starting : null
  const type = e.subagentType || own?.type || 'general-purpose'
  // A twin that runs in a worktree of its own is, to everything else, the agent it is a twin of
  const plain = plainType(type)
  const waitsForIt = (p: Ph['pipeline']): p is NonNullable<Ph['pipeline']> => !!p && !p.agentId && p.steps[p.index] === plain
  // Who started it: Cockpit's own start is a pipeline's step or yours (a press, a command); else another agent or Claude
  const by = own ? (waitsForIt(s0.pipeline) ? 'pipeline' : 'you') : e.parentAgentId ? 'agent' : 'claude'
  await trackAgent($, { id, name: s0.agents.find(x => x.id === id)?.name ?? own?.name ?? agentName(plain, e.description), type, task: own?.task ?? e.description, prompt: e.prompt, by, ...(own?.pick ? { pick: own.pick } : {}), ...(e.provider?.plugin ? { provider: e.provider.plugin } : {}), ...(e.parentAgentId ? { parent: e.parentAgentId } : {}), ...(e.cwd ? { cwd: e.cwd } : {}) })
  // A pipeline's expert whose start hands no id back: the id is known here
  await set($, s => ({
    agentTypes: s.agentTypes.includes(plain) ? s.agentTypes : [...s.agentTypes, plain],
    pipeline: waitsForIt(s.pipeline) ? { ...s.pipeline, agentId: id } : s.pipeline,
  }))
}

// A run that wrote or edited a file, by the tools that do (flows/tools). An agent's log line reads "<tool> <what>"
const changedFiles = (a: Agent) => a.log.some(l => EDIT_TOOLS.some(t => l.t.startsWith(`${t} `)))

// A subagent's tool call, as it starts: counted and logged on its row
export function agentToolCall($: $, agentId: string, tool: string, input: Record<string, unknown>, at: number) {
  const what = String(input.file_path ?? input.notebook_path ?? input.path ?? input.pattern ?? input.command ?? input.description ?? '').split('\n')[0]?.slice(0, 80) ?? ''
  return set($, s => ({ agents: s.agents.map(a => (a.id === agentId ? { ...a, tools: a.tools + 1, log: [...a.log, { at, t: `${tool} ${what}` }].slice(-40) } : a)) }))
}

// A subagent's tool call that went through: the codebase memory follows an edit, an agent's too, and the running flow
// counts its lines
export async function agentToolDone($: $, tool: string, input: Record<string, unknown>, op: FileOp | null) {
  if (!EDIT_TOOLS.includes(tool)) return
  await updateMemory($, String(input.file_path ?? input.notebook_path ?? ''))
  if (op) await set($, s => ({ flows: s.flows.map((f, i) => (i === s.flows.length - 1 && f.status === 'running' ? { ...f, add: f.add + op.add, del: f.del + op.del } : f)) }))
}

// Tests an agent's run: the Verify pipeline (the Prover proves it works, then the Breaker tries to break it), briefed
// with what that agent was asked and reported. auto: after a run that changed files, while the setting is on, and
// never on a tester's own run or while another pipeline runs
export async function testAgent($: $, id: string, auto: boolean) {
  const s = await look($)
  const a = s.agents.find(x => x.id === id)
  if (!a || a.status !== 'done' || TESTERS.includes(a.type)) return
  if (auto && (!s.testAgents || !changedFiles(a) || s.pipeline)) return
  const prior = [`${a.name} (the agent whose work you are testing):\nIts task: ${a.task}\n${a.report || '(it left no report: read the files it changed)'}`]
  await startPipeline($, 'verify', { for: id, prior })
}

// A finished agent for its notice, with what it found: its REPORT, or the first line of a report that has no such lines
const finished = (a: Agent) => ({ ...a, found: reportPart(a.report, 'REPORT') || (reportPart(a.report, 'HANDOFF') ? '' : (a.report.split('\n')[0] ?? '')) })

// A subagent's turn ended: its record, what it changed in its worktree, a notice, its pipeline's next step, then its
// tests and its commit. batch: the agents that finished while others of theirs still ran, for the one notice when the
// last is done; the caller keeps it between calls
export async function agentTurnEnd($: $, agentId: string, answer: string, aborted: boolean, failed: boolean, batch: Set<string>) {
  // A pipeline's own step is tested by the pipeline (Build ends in both testers); any other run that changed files is tested here
  const isStep = (await look($)).pipeline?.agentId === agentId
  await finishAgent($, agentId, answer, aborted, failed)
  // One that ran in its own worktree: what it changed there, against where it started
  const inWorktree = !!(await look($)).agents.find(x => x.id === agentId)?.worktree
  if (inWorktree && !(await measureWorktree($, agentId).catch(() => null))) await toast($, 'Could not read what the agent changed in its worktree; Bring back reads it again')
  const all = (await look($)).agents
  const fin = all.find(x => x.id === agentId)
  const busy = all.filter(x => x.id !== agentId && x.status === 'running' && !x.for)
  // A notice while you are not watching; a pipeline's step tells you with its pipeline instead. One you stopped
  // yourself needs no notice; several that ran together tell you once, when the last is done
  if (!isStep && fin && fin.status !== 'stopped' && !aborted) {
    if (busy.length) batch.add(agentId)
    else {
      const ran = [...batch].map(id => all.find(x => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x && x.status !== 'stopped')
      batch.clear()
      await tellDone($, `agent:${[...ran.map(x => x.id), agentId].join(',')}`, ran.length ? { kind: 'agents', agents: [...ran, fin].map(finished) } : { kind: 'agent', agent: finished(fin) }).catch(() => null)
    }
  }
  await advancePipeline($, agentId, answer, aborted)
  // Its work is in its worktree, not your tree: the testers and auto-commit, which work on your tree, wait for Bring back
  if (!isStep && !aborted && !inWorktree) await testAgent($, agentId, true)
  // Its work is committed as a turn's is (after the testers instead, where commits wait for them)
  const s = await look($)
  const a = s.agents.find(x => x.id === agentId)
  if (!isStep && !aborted && !inWorktree && a && changedFiles(a) && !TESTERS.includes(a.type) && s.git.commitMode !== 'manual' && s.git.autoWhen !== 'tests') {
    await refreshRepo($)
    await decideCommit($)
  }
  await saveHistory($)
}

// Agent types the model can dispatch: the built-ins, the project's and your own agents/*.md, each installed plugin's as <plugin>:<name>, and any type seen starting
export async function discoverAgentTypes($: $) {
  const names = async (dir: string) => (await $.fs.list(dir).catch(() => [])).filter(e => e.name.endsWith('.md')).map(e => e.name.slice(0, -3))
  const home = await homeDir($)
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
  const pick = (await look($)).chooseModel ? pickRun(task, type) : undefined
  await set($, { starting: { name: agentName(type), type, task, ...(pick ? { pick: pickLabel(pick) } : {}) } })
  const r = await startIn($, await worktreeToRun($, type), { prompt: task, description: task.slice(0, 60), type, ...(pick ? { pick } : {}) })
  if ('deny' in r) {
    if (/no verdict/i.test(r.deny ?? '') && (await handOff($, [{ type, brief: task }]))) return set($, s => ({ ui: { ...s.ui, spawnOpen: false, spawnTask: '' } }))
    await note($, `⧉ ${type} could not start: ${r.deny}`)
    return toast($, `Could not start the agent: ${r.deny}`)
  }
  if (r.agentId) await trackAgent($, { id: r.agentId, name: agentName(type), type, task, prompt: task, ...(pick ? { pick: pickLabel(pick) } : {}) })
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
      const name = agentName(plainType(a.type), a.description)
      if (!was) agents = [...agents, { ...takeEarly(a.id), id: a.id, name, type: a.type, task: a.description, prompt: '', status: st, startedAt: at, ...(st !== 'running' ? { endedAt: at } : {}), tools: 0, log: [], cases: [], report: '' }]
      else if (was.status === 'running' && st !== 'running') agents = agents.map(x => (x.id === a.id ? { ...x, status: st, endedAt: at } : x))
    }
    return agents === s.agents ? {} : { agents: agents.slice(-AGENTS_KEPT) }
  })
}

// An agent run again with your instructions: a run's own brief with them added, or a team agent with them as its task
export async function rerun($: $, target: string, text: string) {
  const s = await look($)
  const said = text.trim()
  await set($, st => ({ ui: { ...st.ui, rerunFor: '', rerunText: '' } }))
  if (target.startsWith('type:')) return runExpert($, target.slice(5), [], said ? { task: said } : {})
  const a = s.agents.find(x => x.id === target)
  if (!a) return
  const known = EXPERTS.some(x => x.type === a.type) || s.custom.some(c => c.type === a.type)
  if (known) return runExpert($, a.type, [], { task: said ? `${a.task}\n\nInstructions for this run: ${said}` : a.task })
  return spawnAgent($, said ? `${a.prompt || a.task}\n\nInstructions for this run: ${said}` : a.prompt || a.task, a.type)
}

export async function stopAll($: $) {
  const live = (await look($)).agents.filter(a => a.status === 'running')
  for (const a of live) await stopAgent($, a.id, true)
  await toast($, live.length ? `Stopped ${plural(live.length, 'agent')}` : 'Nothing running')
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
