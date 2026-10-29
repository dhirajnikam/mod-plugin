import type { Agent, Decision, FileOp, GitForm, Line, Ph, PlanItem, TestCase } from '../types'

// Every step a flow can reach, in order. A flow shows its own template's steps plus any it reaches beyond them
export const STEPS = ['Understand', 'Explore', 'Decide', 'Implement', 'Verify', 'Commit', 'Answer']
// The predefined flows: each prompt picks one from its words, and progress is measured against that flow's steps
export const FLOWS: { name: string; label: string; steps: string[]; what: string }[] = [
  { name: 'build', label: 'Build', steps: ['Understand', 'Explore', 'Implement', 'Verify', 'Commit'], what: 'a feature, fix or refactor' },
  { name: 'docs', label: 'Docs', steps: ['Understand', 'Explore', 'Implement', 'Commit'], what: 'README, docs, comments' },
  { name: 'check', label: 'Check', steps: ['Understand', 'Explore', 'Verify', 'Answer'], what: 'review, verify, run the tests' },
  { name: 'answer', label: 'Answer', steps: ['Understand', 'Explore', 'Answer'], what: 'a question, an explanation' },
]
// The flow a prompt is on: from its words, and from what was reached: a question that starts editing files is a Build
export function flowOf(task: string, reached: string[] = [], kind?: string) {
  const t = task.trim().toLowerCase()
  const docs = inferType(t, []) === 'docs'
  const pick = (name: string) => FLOWS.find(f => f.name === name) ?? FLOWS[0]!
  if (kind && FLOWS.some(f => f.name === kind)) return pick(kind)
  if (reached.includes('Implement')) return pick(docs ? 'docs' : 'build')
  if (/\b(review|check|verify|audit|lint|make sure|run (the )?tests?|does it work)\b/.test(t)) return pick('check')
  if (/\?\s*$/.test(t) || /^(what|why|how|where|which|who|when|is|are|does|can|could|should|explain|show|list|tell|describe|summari[sz]e)\b/.test(t)) return pick('answer')
  return pick(docs ? 'docs' : 'build')
}
export const TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'chore']
export const BRANCH_PRESETS = [
  { v: '{kind}/{slug}', label: 'feature/add-login' },
  { v: '{kind}/{ticket}-{slug}', label: 'feature/API-12-add-login' },
  { v: '{user}/{kind}-{slug}', label: 'dev/feature-add-login' },
  { v: '{slug}', label: 'add-login' },
]
export const MSG_PRESETS = [
  { v: '{type}: {subject}', label: 'Conventional' },
  { v: '{ticket} {type}: {subject}', label: 'Ticket first' },
  { v: '{Subject}', label: 'Plain sentence' },
]
export const AUTO_WHENS = [
  { v: 'step', label: 'after each turn that changes files' },
  { v: 'tests', label: 'after the Verify experts pass' },
]
export const COMMIT_MODES: [GitForm['commitMode'], string, string][] = [
  ['auto', 'Auto-commit', 'Cockpit commits by itself, type and branch chosen for you'],
  ['ask', 'Ask me', 'Cockpit proposes each commit; you press Commit or Skip'],
  ['manual', 'Manual', 'Only when you press Commit'],
]
// Branches that work is cut from, never committed to directly when a branch pattern is set
export const BASE_BRANCHES = ['main', 'master', 'develop', 'trunk']

// The commit type a change calls for, from the words of the task and the files it touched
export function inferType(task: string, paths: string[]) {
  const t = task.toLowerCase()
  if (/\b(fix|bug|broken|crash|error|issue|wrong|fail)/.test(t)) return 'fix'
  if (/\b(test|spec|coverage)/.test(t)) return 'test'
  if (/\b(doc|readme|comment|changelog)/.test(t)) return 'docs'
  if (/\b(refactor|clean|simplif|rename|reorgani|tidy)/.test(t)) return 'refactor'
  if (/\b(perf|faster|speed|optimi|cache)/.test(t)) return 'perf'
  if (/\b(chore|bump|upgrade|depend|config|ci\b|lint|format)/.test(t)) return 'chore'
  if (t) return 'feat'
  if (paths.length && paths.every(p => /\.(md|txt|rst)$/i.test(p))) return 'docs'
  if (paths.length && paths.every(p => /(test|spec)/i.test(p))) return 'test'
  return paths.length ? 'feat' : 'chore'
}
// The branch kind a commit type gets: feature, fix, docs, ...
export const kindOf = (type: string) => (type === 'feat' ? 'feature' : type)
export const GIT_OPTS: [keyof GitForm, string][] = [
  ['branchAuto', 'New branch off the base, by the pattern'],
  ['breaking', 'Breaking change'],
  ['preTest', 'Only after the Verify experts pass'],
  ['push', 'Push after commit'],
  ['pr', 'Open pull request'],
  ['draft', 'PR as draft'],
  ['signoff', 'Sign-off'],
  ['gpg', 'GPG sign'],
]
// Cockpit's own experts, shipped as agents/<name>.md; they hand their reports to one another along a pipeline
export const EXPERTS: { type: string; name: string; glyph: string; what: string }[] = [
  { type: 'cockpit:planner', name: 'Planner', glyph: '◆', what: 'reads the task and the code, lays out the smallest plan' },
  { type: 'cockpit:builder', name: 'Builder', glyph: '⚙', what: 'implements the plan with the smallest diff that works' },
  { type: 'cockpit:reviewer', name: 'Reviewer', glyph: '◎', what: 'reviews the change for bugs, edge cases and bloat' },
  { type: 'cockpit:prover', name: 'Prover', glyph: '✓', what: 'proves the change works: tests for the happy paths' },
  { type: 'cockpit:breaker', name: 'Breaker', glyph: '✗', what: 'tries to break the change: abuse, edge cases, bad input' },
  { type: 'cockpit:scribe', name: 'Scribe', glyph: '✎', what: 'brings the README, docs and changelog up to date' },
]
export const expertGlyph = (type: string) => EXPERTS.find(x => x.type === type)?.glyph ?? (type.startsWith('cockpit:') ? '✦' : '⧉')
export const PIPELINES: { name: string; label: string; steps: string[]; what: string }[] = [
  { name: 'build', label: 'Build', steps: ['cockpit:planner', 'cockpit:builder', 'cockpit:reviewer', 'cockpit:prover', 'cockpit:breaker', 'cockpit:scribe'], what: 'plan, build, review, prove, break, document' },
  { name: 'verify', label: 'Verify', steps: ['cockpit:prover', 'cockpit:breaker'], what: 'prove it works, then try to break it' },
  { name: 'review', label: 'Review', steps: ['cockpit:reviewer'], what: 'a second pair of eyes on the diff' },
]
export const expertName = (type: string) => EXPERTS.find(x => x.type === type)?.name ?? (type.startsWith('cockpit:') ? type.slice(8).replace(/(^|-)(\w)/g, (_, d, c: string) => `${d ? ' ' : ''}${c.toUpperCase()}`) : type)
export const AGENT_TYPES = ['general-purpose', 'Explore', 'Plan', ...EXPERTS.map(x => x.type)]

// Judge seats by complexity, and the two-thirds bar
export const nJ = (score: number) => (score <= 3 ? 3 : score <= 6 ? 6 : 9)
export const thrOf = (n: number) => Math.ceil((n * 2) / 3)

export const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export const kTok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
export const slug = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
export const base = (p: string) => p.split(/[\\/]/).pop() ?? p

export const branchName = (g: GitForm, current: string) => {
  if (g.branch) return g.branch
  // A pattern applies when the work sits on a base branch; a branch already cut keeps its name
  if (!g.branchAuto || !BASE_BRANCHES.includes(current) && current !== g.base) return current
  return g.branchPattern
    .replace(/\{kind\}/g, kindOf(g.type))
    .replace(/\{type\}/g, g.type)
    .replace(/\{ticket\}/g, g.ticket.toLowerCase())
    .replace(/\{slug\}/g, slug(g.subject))
    .replace(/\{user\}/g, slug(g.user))
    .replace(/\{scope\}/g, slug(g.scope))
    // Empty fields leave no stray dashes or slashes
    .replace(/-{2,}/g, '-')
    .replace(/(^|\/)-+|-+(?=\/|$)/g, '$1')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/|\/$/g, '')
}

export const commitMsg = (g: GitForm, branch: string) => {
  let m = g.msgPattern
    .replace(/\{type\}/g, g.type)
    .replace(/\(\{scope\}\)/g, g.scope ? `(${g.scope})` : '')
    .replace(/\{scope\}/g, g.scope)
    .replace(/\{subject\}/g, g.subject)
    .replace(/\{Subject\}/g, g.subject.charAt(0).toUpperCase() + g.subject.slice(1))
    .replace(/\{ticket\}/g, g.ticket)
    .replace(/\{branch\}/g, branch)
  if (g.breaking) {
    const i = m.indexOf(': ')
    m = i > 0 ? `${m.slice(0, i)}!${m.slice(i)}` : `BREAKING: ${m}`
  }
  return m
}

const A = (t: string): Line => ({ t: `+ ${t}`, k: 'a' })
const D = (t: string): Line => ({ t: `− ${t}`, k: 'd' })
const C = (t: string): Line => ({ t: `  ${t}`, k: 'c' })
const lines = (s: string) => s.replace(/\r/g, '').split('\n')

// A tool call's input as a file operation, or null for tools that touch no file
export function toOp(tool: string, input: Record<string, unknown>, id: string, at: number): FileOp | null {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const path = str('file_path') || str('path') || str('notebook_path')
  if (tool === 'Read') {
    return { id, op: 'Read', path, at, meta: 'read', add: 0, del: 0, lines: [] }
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const where = path || '.'
    return { id, op: 'Search', path: `${where}  "${str('pattern')}"`, at, meta: 'search', add: 0, del: 0, lines: [] }
  }
  if (tool === 'Write') {
    const body = lines(str('content'))
    return { id, op: 'Write', path, at, meta: `+${body.length}`, add: body.length, del: 0, lines: body.slice(0, 12).map(A) }
  }
  if (tool === 'Edit') {
    const o = lines(str('old_string'))
    const n = lines(str('new_string'))
    return { id, op: 'Edit', path, at, meta: `+${n.length} −${o.length}`, add: n.length, del: o.length, lines: [...o.slice(0, 8).map(D), ...n.slice(0, 8).map(A)] }
  }
  if (tool === 'Bash') {
    const m = str('command').match(/^\s*(?:rm|git rm|del|Remove-Item)\s+(?:-\S+\s+)*([^\s;&|]+)/)
    if (m?.[1]) return { id, op: 'Delete', path: m[1], at, meta: 'deleted', add: 0, del: 0, lines: [] }
  }
  return null
}

// What the spinner says while a tool runs
export function activityOf(tool: string, input: Record<string, unknown>) {
  const p = base(String(input.file_path ?? input.path ?? ''))
  switch (tool) {
    case 'Read':
      return `Reading ${p}`
    case 'Write':
      return `Writing ${p}`
    case 'Edit':
      return `Editing ${p}`
    case 'Grep':
    case 'Glob':
      return `Searching ${p || 'the project'}`
    case 'Bash':
      return /test|jest|vitest|pytest|go test|cargo test/.test(String(input.command)) ? 'Running tests' : `Running ${String(input.command ?? '').split(/\s+/)[0]}`
    case 'Agent':
    case 'Task':
      return `Starting a subagent`
    case 'AskUserQuestion':
      return 'Deciding'
    default:
      return `Using ${tool}`
  }
}

// The step a tool call moves the task into
export function stepOf(tool: string, input: Record<string, unknown>) {
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob' || tool === 'WebFetch' || tool === 'WebSearch') return 'Explore'
  if (tool === 'AskUserQuestion') return 'Decide'
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 'Implement'
  if (tool === 'Bash' && /test|jest|vitest|pytest|go test|cargo test/.test(String(input.command))) return 'Verify'
  if (tool === 'Bash' && /git commit/.test(String(input.command))) return 'Commit'
  return ''
}

// Progress of one flow: its template's steps and any reached beyond them, the last reached active while work runs
// Progress of one flow. Its steps are Claude's own task list while it keeps one (each task's status as Claude set it),
// else the flow template the words of the prompt pick, with any step reached beyond it added. A step done counts 1,
// the one in progress ½: progress is that over the number of steps. A flow picked by hand stands over both
export function progressOf(task: string, reached: string[], isWorking: boolean, kind?: string, plan: PlanItem[] = [], own: { name: string; kind: string }[] = []) {
  const template = !!kind && kind !== 'plan' && kind !== 'task'
  // Steps written for the task: the furthest one whose kind of work was reached is in progress, the ones before it done
  if (own.length && !template && (kind === 'task' || !plan.length)) {
    const last = own.reduce((m, x, i) => (reached.includes(x.kind) ? i : m), -1)
    const steps = own.map((x, i) => ({ name: x.name, st: i < last || (i === last && !isWorking && reached.length > 0) ? 'done' : i === last ? 'active' : 'pending' }))
    const done = steps.filter(x => x.st === 'done').length
    const active = steps.filter(x => x.st === 'active').length
    const at = steps.find(x => x.st === 'active')
    const flow = { name: 'task', label: 'Task', steps: steps.map(x => x.name), what: 'steps written for this task' }
    return { flow, steps, done, active, pct: Math.round(((done + active / 2) / steps.length) * 100), stepName: at ? at.name : reached.length ? 'Idle' : 'Ready' }
  }
  if (plan.length && !template) {
    const steps = plan.map(p => ({ name: p.text.length > 48 ? `${p.text.slice(0, 47)}…` : p.text, st: p.st === 'completed' ? 'done' : p.st === 'in_progress' ? 'active' : 'pending' }))
    const done = steps.filter(x => x.st === 'done').length
    const active = steps.filter(x => x.st === 'active').length
    const at = steps.find(x => x.st === 'active')
    const flow = { name: 'plan', label: 'Plan', steps: steps.map(x => x.name), what: "Claude's own task list" }
    return { flow, steps, done, active, pct: Math.round(((done + active / 2) / steps.length) * 100), stepName: at ? at.name : done === steps.length ? 'Done' : isWorking ? 'Working' : 'Idle' }
  }
  const flow = flowOf(task, reached, template ? kind : undefined)
  const names = STEPS.filter(n => flow.steps.includes(n) || reached.includes(n))
  const last = names.reduce((m, name, i) => (reached.includes(name) ? i : m), -1)
  const steps = names.map((name, i) => ({
    name,
    st: i < last || (i === last && !isWorking && reached.length > 0) ? 'done' : i === last ? 'active' : 'pending',
  }))
  const done = steps.filter(x => x.st === 'done').length
  const active = steps.filter(x => x.st === 'active').length
  const pct = Math.round(((done + active / 2) / names.length) * 100)
  const at = steps.find(x => x.st === 'active')
  return { flow, steps, done, active, pct, stepName: at ? at.name : reached.length ? 'Idle' : 'Ready' }
}
// Steps a model wrote for a task, kept only where each names a known kind of work
const KINDS = ['Understand', 'Explore', 'Decide', 'Implement', 'Verify', 'Commit', 'Answer']
export function parseSteps(text: string) {
  try {
    const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as { step?: unknown; kind?: unknown }[]
    return arr
      .map(x => ({ name: String(x.step ?? '').trim().slice(0, 60), kind: KINDS.find(k => k.toLowerCase() === String(x.kind ?? '').toLowerCase()) ?? '' }))
      .filter(x => x.name && x.kind)
      .slice(0, 7)
  } catch {
    return []
  }
}

export const progress = (s: Ph) => {
  const f = s.flows[s.flows.length - 1]
  return progressOf(s.task, s.reached, s.isWorking, f?.kind, f?.plan, f?.steps)
}

// Claude's task list after one of its plan tools: TodoWrite sends the whole list; TaskCreate adds one (its id is in the
// result), TaskUpdate changes or deletes one by id. An update to a task of an earlier prompt's plan carries that plan over
export function applyPlan(plan: PlanItem[], tool: string, input: Record<string, unknown>, result: unknown, earlier: PlanItem[][] = []): PlanItem[] {
  const st = (x: unknown): PlanItem['st'] => (x === 'completed' || x === 'in_progress' ? x : 'pending')
  // This app's task list: items replace it; advance finishes the task in progress and starts the next; done and start
  // name tasks by their 1-based place; the turn's wrap-up ticks off the rest
  if (tool === 'mcp__ccd_turn__update_plan') {
    if (Array.isArray(input.items)) return (input.items as Record<string, unknown>[]).map((t, i) => ({ id: `p${i}`, text: String(t.content ?? ''), st: st(t.status) })).filter(p => p.text)
    let next = plan.map(p => ({ ...p }))
    if (input.advance === true) {
      const at = next.findIndex(p => p.st === 'in_progress')
      if (at >= 0) next[at] = { ...next[at]!, st: 'completed' }
      const go = next.findIndex((p, i) => i > at && p.st === 'pending')
      if (go >= 0) next[go] = { ...next[go]!, st: 'in_progress' }
    }
    for (const n of Array.isArray(input.done) ? (input.done as number[]) : []) if (next[n - 1]) next[n - 1] = { ...next[n - 1]!, st: 'completed' }
    if (typeof input.start === 'number' && next[input.start - 1]) next = next.map((p, i) => (i === (input.start as number) - 1 ? { ...p, st: 'in_progress' } : p.st === 'in_progress' ? { ...p, st: 'completed' } : p))
    return next
  }
  if (tool === 'mcp__ccd_turn__wrap_up') return plan.map(p => ({ ...p, st: 'completed' as const }))
  if (tool === 'TodoWrite') {
    const todos = Array.isArray(input.todos) ? (input.todos as Record<string, unknown>[]) : []
    return todos.map((t, i) => ({ id: `t${i}`, text: String(t.content ?? ''), st: st(t.status) })).filter(p => p.text)
  }
  if (tool === 'TaskCreate') {
    const id = String(((result as { task?: { id?: unknown } } | undefined)?.task?.id) ?? `c${plan.length}`)
    return [...plan.filter(p => p.id !== id), { id, text: String(input.subject ?? ''), st: 'pending' as const }].filter(p => p.text)
  }
  if (tool === 'TaskUpdate') {
    const id = String(input.taskId ?? '')
    const base = plan.some(p => p.id === id) ? plan : earlier.slice().reverse().find(e => e.some(p => p.id === id)) ?? plan
    if (input.status === 'deleted') return base.filter(p => p.id !== id)
    return base.map(p => (p.id === id ? { ...p, ...(input.subject ? { text: String(input.subject) } : {}), ...(input.status ? { st: st(input.status) } : {}) } : p))
  }
  return plan
}

export function tally(d: Decision) {
  const n = d.votes.length
  const cast = d.votes.filter(v => v >= 0)
  const counts = d.opts.map((_, i) => cast.filter(v => v === i).length)
  const top = counts.reduce((b, c, i) => (c > (counts[b] ?? 0) ? i : b), 0)
  return { n, revealed: cast.length, counts, top, yes: counts[top] ?? 0, passes: (counts[top] ?? 0) >= thrOf(n) }
}

// "CASE PASS name" / "CASE FAIL name :: why" lines from a tester's answer
export function parseCases(text: string): TestCase[] {
  return text
    .split('\n')
    .map(l => l.match(/^\s*CASE\s+(PASS|FAIL|FIXED)\s+(.+?)(?:\s+::\s+(.*))?\s*$/i))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({
      n: m[2] ?? '',
      st: (m[1] ?? '').toUpperCase() === 'PASS' ? 'pass' : (m[1] ?? '').toUpperCase() === 'FIXED' ? 'fixed' : 'fail',
      ...(m[3] ? { err: m[3] } : {}),
    }))
}

// The REPORT and HANDOFF lines of an expert's answer, or its last lines
export function parseReport(text: string) {
  const lines = text.split('\n').map(l => l.trim())
  const pick = (tag: string) => lines.filter(l => l.toUpperCase().startsWith(`${tag}:`)).map(l => l.slice(tag.length + 1).trim()).pop() ?? ''
  const report = pick('REPORT')
  const handoff = pick('HANDOFF')
  return report || handoff ? `REPORT: ${report || '—'}\nHANDOFF: ${handoff || 'nothing'}` : lines.filter(Boolean).slice(-6).join('\n')
}

// The latest Prover and Breaker: their cases together, and whether both are done without a failure
export function verifyState(agents: Agent[]) {
  const latest = (type: string) => agents.filter(a => a.type === type).pop()
  const pair = [latest('cockpit:prover'), latest('cockpit:breaker')]
  const cases = pair.flatMap(a => a?.cases ?? [])
  const fail = cases.filter(c => c.st === 'fail').length
  return {
    cases,
    fail,
    pass: cases.length - fail,
    running: pair.some(a => a?.status === 'running'),
    passed: pair.every(a => a?.status === 'done') && cases.length > 0 && fail === 0,
  }
}

export type TreeRow = { path: string; isDir: boolean; name: string; depth: number; tag: string; op: string; touched: boolean; collapsed: boolean }

// Folder tree of the project and every path the session touched. A folder not toggled by hand is open when
// something under it was touched and folded away otherwise, so a large project stays short
export function tree(ops: FileOp[], collapsed: Record<string, boolean>, root: string, project: string[] = []): TreeRow[] {
  const rel = (p: string) => p.replace(/\\/g, '/').replace(root.replace(/\\/g, '/').replace(/\/?$/, '/'), '')
  const files = ops.filter(o => o.op !== 'Search' && o.path)
  const isClosed = (d: string) => collapsed[d] ?? !files.some(o => rel(o.path).startsWith(`${d}/`))
  const paths = [...new Set([...project, ...files.map(o => rel(o.path))])].sort((a, b) => {
    const da = a.includes('/'), db = b.includes('/')
    return da === db ? a.localeCompare(b) : da ? -1 : 1
  })
  const rows: TreeRow[] = []
  const seen = new Set<string>()
  for (const p of paths) {
    const parts = p.split('/')
    const hidden = (i: number) => parts.slice(0, i).some((_, j) => isClosed(parts.slice(0, j + 1).join('/')))
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      if (seen.has(d)) continue
      seen.add(d)
      if (hidden(i - 1)) continue
      const touched = files.some(o => rel(o.path).startsWith(`${d}/`) && o.op !== 'Read')
      rows.push({ path: d, isDir: true, name: `${parts[i - 1]}/`, depth: i - 1, tag: '', op: '', touched, collapsed: isClosed(d) })
    }
    if (hidden(parts.length - 1)) continue
    const mine = files.filter(o => rel(o.path) === p)
    const last = mine[mine.length - 1]
    const tag = !last ? '' : last.op === 'Read' ? 'read' : last.op === 'Write' ? `new ${last.meta}` : last.op === 'Delete' ? 'deleted' : last.meta
    rows.push({ path: p, isDir: false, name: parts[parts.length - 1] ?? p, depth: parts.length - 1, tag, op: last?.op ?? '', touched: !!last && last.op !== 'Read', collapsed: false })
  }
  return rows
}

// The progress ring as rows of half-block text runs: each cell holds two pixels, top and bottom, as ▀ with two colours.
// Cells outside the ring stay transparent, so the ring sits on any terminal background.
export type Run = { t: string; fg?: string; bg?: string }
export function ringRuns(pct: number, fill: string, track: string, ink: string, cols = 14): Run[][] {
  const rows = Math.ceil(cols / 2)
  const c = (cols - 1) / 2
  const r1 = cols / 2 - 0.3
  const r0 = r1 - 2.1
  const px = (x: number, y: number) => {
    const d = Math.hypot(x - c, y - c)
    if (d > r1 || d < r0) return undefined
    const a = (Math.atan2(x - c, -(y - c)) / (2 * Math.PI) + 1) % 1
    return a <= pct / 100 ? fill : track
  }
  const label = `${pct}%`
  const mid = Math.floor(rows / 2)
  const start = Math.floor((cols - label.length) / 2)
  return Array.from({ length: rows }, (_, row) => {
    const runs: Run[] = []
    for (let col = 0; col < cols; col++) {
      const ch = row === mid ? label[col - start] : undefined
      const top = px(col, row * 2)
      const bot = px(col, row * 2 + 1)
      const cell: Run = ch ? { t: ch, fg: ink } : top && bot ? { t: '▀', fg: top, bg: bot } : top ? { t: '▀', fg: top } : bot ? { t: '▄', fg: bot } : { t: ' ' }
      const last = runs[runs.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.t += cell.t
      else runs.push(cell)
    }
    return runs
  })
}

// Self-check: the parts a broken edit would quietly corrupt
export function selfCheck() {
  const g = { branch: '', branchAuto: true, branchPattern: '{type}/{ticket}-{slug}', ticket: 'API-142', user: 'dev', base: 'main', type: 'feat', scope: 'auth', subject: 'add rate limiting to login', body: '', msgPattern: '{type}({scope}): {subject}', commitMode: 'ask', autoWhen: 'step', setupDone: true, breaking: false, push: false, pr: false, draft: false, signoff: false, gpg: false, preTest: false } as GitForm
  const checks: [unknown, unknown][] = [
    [branchName(g, 'main'), 'feat/api-142-add-rate-limiting-to-login'],
    [branchName({ ...g, branchPattern: '{kind}/{slug}' }, 'main'), 'feature/add-rate-limiting-to-login'],
    [branchName({ ...g, type: 'fix', branchPattern: '{kind}/{slug}' }, 'master'), 'fix/add-rate-limiting-to-login'],
    [branchName(g, 'feature/old'), 'feature/old'],
    [branchName({ ...g, ticket: '' }, 'main'), 'feat/add-rate-limiting-to-login'],
    [branchName({ ...g, ticket: '', subject: '' }, 'main'), 'feat'],
    [inferType('fix the login bug', []), 'fix'],
    [inferType('add a settings page', []), 'feat'],
    [inferType('', ['README.md']), 'docs'],
    [inferType('', []), 'chore'],
    [commitMsg(g, 'x'), 'feat(auth): add rate limiting to login'],
    [commitMsg({ ...g, breaking: true }, 'x'), 'feat(auth)!: add rate limiting to login'],
    [nJ(2), 3], [nJ(5), 6], [nJ(8), 9], [thrOf(6), 4],
    [flowOf('what does this hook do?').name, 'answer'],
    [flowOf('add a settings page').name, 'build'],
    [flowOf('update the readme').name, 'docs'],
    [flowOf('make sure it works').name, 'check'],
    [flowOf('what is x', ['Understand', 'Explore', 'Implement']).name, 'build'],
    [flowOf('what is x', ['Understand', 'Explore', 'Implement'], 'answer').name, 'answer'],
    [progressOf('why?', ['Understand', 'Explore', 'Answer'], false).pct, 100],
    [progressOf('x', ['Understand', 'Explore', 'Implement'], true, undefined, [], [{ name: 'Read the hooks', kind: 'Explore' }, { name: 'Fix the path', kind: 'Implement' }, { name: 'Run the tests', kind: 'Verify' }, { name: 'Commit', kind: 'Commit' }]).pct, 38],
    [parseSteps('ok: [{"step":"Read the hooks","kind":"Explore"},{"step":"x","kind":"Nope"},{"step":"Fix it","kind":"implement"}]').map(x => x.kind).join(), 'Explore,Implement'],
    [progressOf('x', [], true, undefined, [{ id: 'a', text: 'a', st: 'completed' }, { id: 'b', text: 'b', st: 'in_progress' }, { id: 'c', text: 'c', st: 'pending' }, { id: 'd', text: 'd', st: 'pending' }]).pct, 38],
    [applyPlan([], 'TaskUpdate', { taskId: '2', status: 'completed' }, {}, [[{ id: '2', text: 'old', st: 'pending' }]]).map(p => p.st).join(), 'completed'],
    [applyPlan([{ id: 'a', text: 'a', st: 'in_progress' }, { id: 'b', text: 'b', st: 'pending' }], 'mcp__ccd_turn__update_plan', { advance: true }, {}).map(p => p.st).join(), 'completed,in_progress'],
    [applyPlan([{ id: 'a', text: 'a', st: 'pending' }, { id: 'b', text: 'b', st: 'pending' }, { id: 'c', text: 'c', st: 'pending' }], 'mcp__ccd_turn__update_plan', { done: [1], start: 3 }, {}).map(p => p.st).join(), 'completed,pending,in_progress'],
    [progressOf('add x', ['Understand', 'Explore', 'Decide', 'Implement'], true).steps.map(x => x.name).join(), 'Understand,Explore,Decide,Implement,Verify,Commit'],
    [parseCases('CASE PASS works\nCASE FAIL bad :: got 200').map(c => c.st).join(), 'pass,fail'],
    [tally({ id: 'd', q: '', opts: ['a', 'b'], at: 0, score: 5, signals: [], votes: [0, 0, 0, 0, 1, -1], status: 'voting', result: '' }).passes, true],
    // d on lane 0 opens lane 1 for c; c sits on lane 1; b on lane 0 with c's lane passing; a takes both lanes in
    [graphCheck(), JSON.stringify([[0, [1], [], []], [1, [], [], [0]], [0, [], [], [1]], [0, [], [1], []]])],
  ]
  return checks.filter(([a, b]) => a !== b)
}

// The design's SVG progress ring, for surfaces that draw SVG (desktop, the editor, mobile)
export function ringSvg(pct: number, step: string, c: { accent: string; track: string; text: string; dim: string }) {
  const off = (314.16 * (1 - pct / 100)).toFixed(1)
  const esc = (x: string) => x.replace(/[<>&"]/g, ch => `&#${ch.charCodeAt(0)};`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">` +
    `<circle cx="60" cy="60" r="50" fill="none" stroke="${c.track}" stroke-width="8"/>` +
    `<circle cx="60" cy="60" r="50" fill="none" stroke="${c.accent}" stroke-width="8" stroke-linecap="round" stroke-dasharray="314.16" stroke-dashoffset="${off}" transform="rotate(-90 60 60)"/>` +
    `<text x="60" y="62" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="${c.text}">${pct}%</text>` +
    `<text x="60" y="82" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="${c.dim}">${esc(step)}</text></svg>`
}

// Agent icons for surfaces that draw SVG: line icons in a tinted tile, coloured by state. A running one turns an arc
// around its tile and breathes (SMIL, drawn in an interactive frame); a finished one wears a badge
export type IconState = 'idle' | 'running' | 'done' | 'failed' | 'stopped' | 'pending'
const ICON_PATHS: Record<string, string> = {
  'cockpit:planner': '<path d="M9.5 6h10M9.5 12h10M9.5 18h10"/><circle cx="5" cy="6" r="1.3" fill="currentColor"/><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="5" cy="18" r="1.3" fill="currentColor"/>',
  'cockpit:builder': '<rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.8"/><rect x="8.25" y="3.5" width="7.5" height="7.5" rx="1.8"/>',
  'cockpit:reviewer': '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'cockpit:prover': '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 7.9-7.5 9.5-4.3-1.6-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  'cockpit:breaker': '<rect x="7.5" y="8" width="9" height="12" rx="4.5"/><path d="M12 11v9M9.5 5l1 2.5M14.5 5l-1 2.5M3.5 11.5h4M16.5 11.5h4M3.5 16.5h4M16.5 16.5h4"/>',
  'cockpit:scribe': '<path d="M5 19l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L9 17.5z"/><path d="M14.5 6l3 3M4 21h16"/>',
}
const SPARK = '<path d="M11 3.5l1.9 5.4 5.4 1.9-5.4 1.9L11 18.1l-1.9-5.4-5.4-1.9 5.4-1.9z"/><path d="M18.5 15v5M16 17.5h5"/>'
const BOT = '<rect x="4.5" y="8" width="15" height="11" rx="3.5"/><path d="M12 4.5V8"/><circle cx="9.5" cy="13.5" r="1.1" fill="currentColor"/><circle cx="14.5" cy="13.5" r="1.1" fill="currentColor"/>'
export const ICON_COLORS: Record<IconState, string> = { idle: '#b4833a', running: '#d39b2a', done: '#3f9b5f', failed: '#d0574f', stopped: '#8b8b8b', pending: '#9b9b9b' }
export function agentIconSvg(type: string, state: IconState) {
  const c = ICON_COLORS[state]
  const body = ICON_PATHS[type] ?? (type.startsWith('cockpit:') ? SPARK : BOT)
  const live = state === 'running'
  const breathe = live ? '<animate attributeName="opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite"/>' : ''
  const arc = live
    ? `<circle cx="18" cy="18" r="16.5" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="24 80"><animateTransform attributeName="transform" type="rotate" from="0 18 18" to="360 18 18" dur="1.1s" repeatCount="indefinite"/></circle>`
    : ''
  const badge =
    state === 'done' ? `<circle cx="29.5" cy="29.5" r="5.5" fill="${c}"/><path d="M27 29.6l1.7 1.7 3.2-3.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
    : state === 'failed' ? `<circle cx="29.5" cy="29.5" r="5.5" fill="${c}"/><path d="M27.6 27.6l3.8 3.8M31.4 27.6l-3.8 3.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36"><rect x="3" y="3" width="30" height="30" rx="9" fill="${c}" fill-opacity="${state === 'pending' || state === 'stopped' ? 0.1 : 0.16}"/><g transform="translate(6 6)" fill="none" stroke="${c}" color="${c}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${breathe}${body}</g>${arc}${badge}</svg>`
}

// The commit graph laid out in lanes, one row a commit (newest first, topo order). For each row: the lane of its dot
// (col), whether a line comes into it from above (top) and leaves below (bottom), the lanes that pass straight
// through (through), the lanes that end in it, as branches merged or forked from it (into), and the lanes its other
// parents leave by (out), a merge's second parent opening a lane to the right
export type GraphRow = { col: number; top: boolean; bottom: boolean; through: number[]; into: number[]; out: number[]; width: number }
export function graphRows(log: { sha: string; parents: string[] }[]): GraphRow[] {
  const lanes: (string | null)[] = []
  const free = (not: number) => {
    const i = lanes.findIndex((x, k) => x === null && k !== not)
    if (i >= 0) return i
    lanes.push(null)
    return lanes.length - 1
  }
  return log.map(c => {
    let col = lanes.indexOf(c.sha)
    const top = col >= 0
    if (col < 0) col = free(-1)
    const before = lanes.slice()
    const into = before.flatMap((x, i) => (x === c.sha && i !== col ? [i] : []))
    for (const i of into) lanes[i] = null
    const through = before.flatMap((x, i) => (x !== null && x !== c.sha && i !== col ? [i] : []))
    lanes[col] = c.parents[0] ?? null
    const out: number[] = []
    for (const p of c.parents.slice(1)) {
      let j = lanes.indexOf(p)
      if (j < 0 || j === col) {
        j = free(col)
        lanes[j] = p
      }
      out.push(j)
    }
    const width = Math.max(before.length, lanes.length, col + 1)
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    return { col, top, bottom: c.parents.length > 0, through, into, out, width }
  })
}

// Lane colours, cycled: distinct on light and dark
export const LANE_COLORS = ['#b4833a', '#4f8fe0', '#3f9b5f', '#c0609a', '#d39b2a', '#7a6fd0', '#2fa3a3', '#d0574f']
export const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length] ?? '#b4833a'

// One row of the graph as SVG, for surfaces that draw it: rows stack with no gap, so their lines meet
export function graphSvg(r: GraphRow, width: number, node: 'plain' | 'head' | 'unpushed' | 'merge', h = 30) {
  const x = (i: number) => 9 + i * 14
  const m = h / 2
  const w = x(Math.max(width, 1) - 1) + 9
  const line = (i: number, y1: number, y2: number) => `<line x1="${x(i)}" y1="${y1}" x2="${x(i)}" y2="${y2}" stroke="${laneColor(i)}" stroke-width="2"/>`
  const curve = (from: number, y1: number, to: number, y2: number, c: string) =>
    `<path d="M${x(from)} ${y1} C${x(from)} ${(y1 + y2) / 2} ${x(to)} ${(y1 + y2) / 2} ${x(to)} ${y2}" fill="none" stroke="${c}" stroke-width="2"/>`
  const c = laneColor(r.col)
  const parts = [
    ...r.through.map(i => line(i, 0, h)),
    r.top ? line(r.col, 0, m) : '',
    r.bottom ? line(r.col, m, h) : '',
    ...r.into.map(i => curve(i, 0, r.col, m, laneColor(i))),
    ...r.out.map(j => curve(r.col, m, j, h, laneColor(j))),
    node === 'unpushed'
      ? `<circle cx="${x(r.col)}" cy="${m}" r="5" fill="none" stroke="${c}" stroke-width="2.4"/>`
      : node === 'head'
        ? `<circle cx="${x(r.col)}" cy="${m}" r="7" fill="none" stroke="${c}" stroke-width="1.6" opacity="0.6"/><circle cx="${x(r.col)}" cy="${m}" r="4.5" fill="${c}"/>`
        : node === 'merge'
          ? `<rect x="${x(r.col) - 4.5}" y="${m - 4.5}" width="9" height="9" rx="2" transform="rotate(45 ${x(r.col)} ${m})" fill="${c}"/>`
          : `<circle cx="${x(r.col)}" cy="${m}" r="4.5" fill="${c}"/>`,
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${parts.join('')}</svg>`
}

// One row of the graph as coloured text for the terminal: a cell per lane and one between, ● on the commit's lane,
// │ through, ╯ where a lane ends in it, ╮ where a lane leaves it, ─ joining them
export function graphText(r: GraphRow, width: number, node: string): Run[] {
  const cells: Run[] = Array.from({ length: Math.max(width, 1) * 2 - 1 }, () => ({ t: ' ' }))
  const put = (k: number, ch: string, lane: number) => {
    if (k >= 0 && k < cells.length) cells[k] = { t: ch, fg: laneColor(lane) }
  }
  for (const i of r.through) put(i * 2, '│', i)
  for (const i of [...r.into.map(k => [k, '╯'] as const), ...r.out.map(k => [k, '╮'] as const)]) {
    const [k, ch] = i
    const lo = Math.min(k, r.col), hi = Math.max(k, r.col)
    for (let q = lo * 2 + 1; q < hi * 2; q++) if (cells[q]?.t === ' ') put(q, '─', k)
    put(k * 2, k > r.col ? ch : ch === '╯' ? '╰' : '╭', k)
  }
  put(r.col * 2, node, r.col)
  const runs: Run[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.fg === c.fg) last.t += c.t
    else runs.push({ ...c })
  }
  return runs
}

// Self-check of the layout: a branch and its merge
export function graphCheck() {
  // d merges c (a branch off a) into b; a is the root
  const rows = graphRows([
    { sha: 'd', parents: ['b', 'c'] },
    { sha: 'c', parents: ['a'] },
    { sha: 'b', parents: ['a'] },
    { sha: 'a', parents: [] },
  ])
  return JSON.stringify(rows.map(r => [r.col, r.out, r.into, r.through]))
}
