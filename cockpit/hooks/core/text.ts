// A duration as minutes:seconds
export const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export const kTok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
export const slug = (t: string) =>
  t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40)
export const base = (p: string) => p.split(/[\\/]/).pop() ?? p

// A stretch of text in one colour: what a drawing made of characters (the ring, the git graph) is built from
export type TextRun = { t: string; fg?: string; bg?: string }
// Adds a cell to a line of runs: one of its neighbour's colour joins that run
export function pushRun(runs: TextRun[], cell: TextRun) {
  const last = runs[runs.length - 1]
  if (last && last.fg === cell.fg) last.t += cell.t
  else runs.push({ ...cell })
}

export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
// As cut, for a label in a drawing: no space is left before the ellipsis
export const cutTrim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
// A path with forward slashes and no trailing one, so two spellings of a folder compare equal
export const slashed = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
// Text made safe to sit inside SVG or XML
export const esc = (x: string) => x.replace(/[<>&"]/g, ch => `&#${ch.charCodeAt(0)};`)
// Text someone else wrote (a PR title, a config file's value), made safe to draw: control characters (escapes,
// newlines) become spaces, since the pane refuses to draw them
export const plain = (x: unknown) => String(x ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')

// What a command said went wrong: the first line of its error output, or of its output when it wrote no error
export const firstLine = (r: { stdout: string; stderr?: string }) => (r.stderr || r.stdout).trim().split('\n')[0] ?? ''

// The kind of work a task's words name, as a commit type, or '' when they name none. The first row that matches wins,
// so "fix the readme" is a fix, not docs. The commit type (git/git-form.ts) and the flow a prompt is on
// (flows/flows.ts) both read it
const WORK_WORDS: [string, RegExp][] = [
  ['fix', /\b(fix|bug|broken|crash|error|issue|wrong|fail)/],
  ['test', /\b(test|specs?\b|coverage)/],
  ['docs', /\b(doc|readme|comment|changelog)/],
  ['refactor', /\b(refactor|clean|simplif|rename|reorgani|tidy)/],
  ['perf', /\b(perf\b|performance|faster|speed|optimi|cache)/],
  ['chore', /\b(chore|bump|upgrade|depend|config|ci\b|lint|format)/],
]
export function workOf(task: string) {
  const t = task.toLowerCase()
  return WORK_WORDS.find(([, re]) => re.test(t))?.[0] ?? ''
}
