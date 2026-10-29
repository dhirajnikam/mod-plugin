import type { Agent, Decision, FileOp, GitForm, Line, Ph, TestCase } from '../types'

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
export function progressOf(task: string, reached: string[], isWorking: boolean, kind?: string) {
  const flow = flowOf(task, reached, kind)
  const names = STEPS.filter(n => flow.steps.includes(n) || reached.includes(n))
  const last = names.reduce((m, name, i) => (reached.includes(name) ? i : m), -1)
  const steps = names.map((name, i) => ({
    name,
    st: i < last || (i === last && !isWorking && reached.length > 0) ? 'done' : i === last ? 'active' : 'pending',
  }))
  const done = steps.filter(x => x.st === 'done').length
  const active = steps.some(x => x.st === 'active') ? 0.5 : 0
  const pct = Math.round(((done + active) / names.length) * 100)
  const at = steps.find(x => x.st === 'active')
  return { flow, steps, pct, stepName: at ? at.name : reached.length ? 'Idle' : 'Ready' }
}
export const progress = (s: Ph) => progressOf(s.task, s.reached, s.isWorking, s.flows[s.flows.length - 1]?.kind)

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
    [progressOf('add x', ['Understand', 'Explore', 'Decide', 'Implement'], true).steps.map(x => x.name).join(), 'Understand,Explore,Decide,Implement,Verify,Commit'],
    [parseCases('CASE PASS works\nCASE FAIL bad :: got 200').map(c => c.st).join(), 'pass,fail'],
    [tally({ id: 'd', q: '', opts: ['a', 'b'], at: 0, score: 5, signals: [], votes: [0, 0, 0, 0, 1, -1], status: 'voting', result: '' }).passes, true],
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
