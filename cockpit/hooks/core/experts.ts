import type { TestCase, Agent } from '../../types'

// Cockpit's own experts are registered as cockpit:<name>
const PREFIX = 'cockpit:'
export const isOwn = (type: string) => type.startsWith(PREFIX)

// How many test cases passed: one that passed, or failed and was fixed. One still running is not a pass
export const passedOf = (cases: { st: string }[]) => cases.filter(c => c.st === 'pass' || c.st === 'fixed').length
export const shortType = (type: string) => (isOwn(type) ? type.slice(PREFIX.length) : type)

// Cockpit's own experts, shipped as agents/<name>.md; they hand their reports to one another along a pipeline.
// start: the level a run of this expert starts at when its model and effort are chosen (agents/pick.ts): thinking work
// high, writing and plain checking in the middle, docs low; why: the words that choice is explained with.
// icon: its line icon, as SVG drawn on a 24-unit grid (agents/agents-view.ts)
export const EXPERTS: { type: string; name: string; glyph: string; what: string; start: number; why?: string; icon: string }[] = [
  {
    type: `${PREFIX}planner`, name: 'Planner', glyph: '◆', what: 'reads the task and the code, lays out the smallest plan', start: 4, why: 'planning needs depth',
    icon: '<path d="M9.5 6h10M9.5 12h10M9.5 18h10"/><circle cx="5" cy="6" r="1.3" fill="currentColor"/><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="5" cy="18" r="1.3" fill="currentColor"/>',
  },
  {
    type: `${PREFIX}builder`, name: 'Builder', glyph: '⚙', what: 'implements the plan with the smallest diff that works', start: 2,
    icon: '<rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.8"/><rect x="8.25" y="3.5" width="7.5" height="7.5" rx="1.8"/>',
  },
  {
    type: `${PREFIX}reviewer`, name: 'Reviewer', glyph: '◎', what: 'reviews the change for bugs, edge cases and bloat', start: 4, why: 'review needs a close read',
    icon: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  },
  {
    type: `${PREFIX}prover`, name: 'Prover', glyph: '✓', what: 'proves the change works: tests for the happy paths', start: 2,
    icon: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 7.9-7.5 9.5-4.3-1.6-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  },
  {
    type: `${PREFIX}breaker`, name: 'Breaker', glyph: '✗', what: 'tries to break the change: abuse, edge cases, bad input', start: 3, why: 'breaking things needs care',
    icon: '<rect x="7.5" y="8" width="9" height="12" rx="4.5"/><path d="M12 11v9M9.5 5l1 2.5M14.5 5l-1 2.5M3.5 11.5h4M16.5 11.5h4M3.5 16.5h4M16.5 16.5h4"/>',
  },
  {
    type: `${PREFIX}scribe`, name: 'Scribe', glyph: '✎', what: 'brings the README, docs and changelog up to date', start: 0, why: 'writing docs',
    icon: '<path d="M5 19l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L9 17.5z"/><path d="M14.5 6l3 3M4 21h16"/>',
  },
]
// The two experts that test another's work: the Prover, then the Breaker
export const TESTERS = [`${PREFIX}prover`, `${PREFIX}breaker`]
export const expertGlyph = (type: string) => EXPERTS.find(x => x.type === type)?.glyph ?? (isOwn(type) ? '✦' : '⧉')
export const PIPELINES: { name: string; label: string; steps: string[]; what: string }[] = [
  { name: 'build', label: 'Build', steps: [`${PREFIX}planner`, `${PREFIX}builder`, `${PREFIX}reviewer`, `${PREFIX}prover`, `${PREFIX}breaker`, `${PREFIX}scribe`], what: 'plan, build, review, prove, break, document' },
  { name: 'verify', label: 'Verify', steps: [...TESTERS], what: 'prove it works, then try to break it' },
  { name: 'review', label: 'Review', steps: [`${PREFIX}reviewer`], what: 'a second pair of eyes on the diff' },
]
export const expertName = (type: string) => EXPERTS.find(x => x.type === type)?.name ?? (isOwn(type) ? shortType(type).replace(/(^|-)(\w)/g, (_, d, c: string) => `${d ? ' ' : ''}${c.toUpperCase()}`) : type)
// An agent's name wherever Cockpit shows it, however it learned of the agent: the expert's where its type is one, else
// what it was described as, else Agent for a general-purpose one and its type for any other
export const agentName = (type: string, description = '') => (expertName(type) !== type ? expertName(type) : description || (type === 'general-purpose' ? 'Agent' : type))
export const AGENT_TYPES = ['general-purpose', 'Explore', 'Plan', ...EXPERTS.map(x => x.type)]
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
// What a line that starts with the tag says (REPORT: …), the tag in any case; of several such lines, the last
const tagged = (text: string, tag: string) => text.split('\n').map(l => l.trim()).filter(l => l.toUpperCase().startsWith(`${tag}:`)).map(l => l.slice(tag.length + 1).trim()).pop() ?? ''
// The REPORT and HANDOFF lines of an expert's answer, or its last lines
export function parseReport(text: string) {
  const lines = text.split('\n').map(l => l.trim())
  const report = tagged(text, 'REPORT')
  const handoff = tagged(text, 'HANDOFF')
  return report || handoff ? `REPORT: ${report || '—'}\nHANDOFF: ${handoff || 'nothing'}` : lines.filter(Boolean).slice(-6).join('\n')
}
// What a kept report says under REPORT or HANDOFF, read by the rule that wrote it, so every place that shows a report
// shows the same words (a pipeline's kept report, which has the expert's name above, too). '' where the report has no
// such line, and for the — parseReport writes where an answer had a HANDOFF and no REPORT
export function reportPart(report: string, tag: 'REPORT' | 'HANDOFF') {
  const said = tagged(report, tag)
  return said === '—' ? '' : said
}
// The latest Prover and Breaker: their cases together, and whether both are done without a failure
export function verifyState(agents: Agent[]) {
  const latest = (type: string) => agents.filter(a => a.type === type).pop()
  const pair = TESTERS.map(latest)
  const cases = pair.flatMap(a => a?.cases ?? [])
  const fail = cases.filter(c => c.st === 'fail').length
  return {
    cases,
    fail,
    pass: passedOf(cases),
    running: pair.some(a => a?.status === 'running'),
    passed: pair.every(a => a?.status === 'done') && cases.length > 0 && fail === 0,
  }
}
// The words of a task that carry meaning
const STOP = new Set('the a an and or of to in on for with is it this that be as at by from fix add make update change please can you i we my our me it\'s do does into also then them its'.split(' '))
const words = (x: string) => new Set(x.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)))
// Agent memory: earlier runs on a task like this one, by the words the two tasks share (Jaccard over the words that
// carry meaning), best first; only runs that left something to learn from (a report or test cases) count
// ponytail: word overlap, no embeddings; enough to find "fix the login bug" from "login bug again"
export function similarRuns(task: string, runs: Agent[]) {
  const a = words(task)
  if (!a.size) return []
  const seen = new Set<string>()
  return runs
    .filter(r => r.status !== 'running' && r.task && (r.report || r.cases.length))
    .map(r => {
      const b = words(r.task)
      const both = [...a].filter(w => b.has(w)).length
      return { run: r, score: both / (a.size + b.size - both || 1) }
    })
    .filter(x => x.score >= 0.2 && x.run.task.trim() !== task.trim())
    .sort((x, y) => y.score - x.score || (y.run.endedAt ?? 0) - (x.run.endedAt ?? 0))
    .filter(x => {
      const k = `${x.run.type}|${x.run.task}`
      return !seen.has(k) && (seen.add(k), true)
    })
    .slice(0, 3)
}
// A remembered run in a line: its REPORT, or with none its cases' tally
export const recallOf = (r: Agent) => {
  const rep = reportPart(r.report, 'REPORT')
  const fail = r.cases.filter(c => c.st === 'fail').length
  return rep || (r.cases.length ? `${passedOf(r.cases)}/${r.cases.length} cases passed${fail ? `, failing: ${r.cases.filter(c => c.st === 'fail').map(c => c.n).slice(0, 3).join(', ')}` : ''}` : '')
}
