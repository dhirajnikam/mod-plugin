import type { Line, FileOp } from '../../types'
import { base } from '../core/text'

const A = (t: string): Line => ({ t: `+ ${t}`, k: 'a' })
const D = (t: string): Line => ({ t: `− ${t}`, k: 'd' })
const lines = (s: string) => s.replace(/\r/g, '').split('\n')
// A shell command that runs tests (a whole word, so `latest` or `cat tests/x` is not one)
const TESTS = /\b(tests?|jest|vitest|pytest|unittest|nextest)\b(?!\/)/
// The tools that write or edit a file: the one list every reader of "did this change a file" goes by
export const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']
export const isEditTool = (tool: string) => EDIT_TOOLS.includes(tool)
// A tool call's input as a file operation, or null for tools that touch no file
export function toOp(tool: string, input: Record<string, unknown>, id: string, at: number): FileOp | null {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const path = str('file_path') || str('notebook_path') || str('path')
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
  // A notebook cell: its new source is what is known (the cell it replaces is not in the input)
  if (tool === 'NotebookEdit') {
    const n = input.edit_mode === 'delete' ? [] : lines(str('new_source'))
    return { id, op: 'Edit', path, at, meta: `+${n.length}`, add: n.length, del: 0, lines: n.slice(0, 8).map(A) }
  }
  // Several edits of one file: counted together, the first lines of each side shown
  if (tool === 'MultiEdit') {
    const edits = (Array.isArray(input.edits) ? input.edits : []) as { old_string?: unknown; new_string?: unknown }[]
    const o = edits.flatMap(x => lines(typeof x?.old_string === 'string' ? x.old_string : ''))
    const n = edits.flatMap(x => lines(typeof x?.new_string === 'string' ? x.new_string : ''))
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
  const p = base(String(input.file_path ?? input.notebook_path ?? input.path ?? ''))
  switch (tool) {
    case 'Read':
      return `Reading ${p}`
    case 'Write':
      return `Writing ${p}`
    case 'Edit':
    case 'NotebookEdit':
    case 'MultiEdit':
      return `Editing ${p}`
    case 'Grep':
    case 'Glob':
      return `Searching ${p || 'the project'}`
    case 'Bash':
      return TESTS.test(String(input.command)) ? 'Running tests' : `Running ${String(input.command ?? '').split(/\s+/)[0]}`
    case 'Agent':
    case 'Task':
      return `Starting a subagent`
    case 'AskUserQuestion':
      return 'Deciding'
    default:
      return `Using ${tool}`
  }
}
export function stepOf(tool: string, input: Record<string, unknown>) {
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob' || tool === 'WebFetch' || tool === 'WebSearch') return 'Explore'
  if (tool === 'AskUserQuestion') return 'Decide'
  if (isEditTool(tool)) return 'Implement'
  if (tool !== 'Bash') return ''
  const cmd = String(input.command ?? '')
  if (/git commit/.test(cmd)) return 'Commit'
  if (TESTS.test(cmd)) return 'Verify'
  // Work done through the shell counts as the tools' would: writing files is implementing, reading them exploring
  if (/(^|[\s;&|(])(sed\s+-i|perl\s+-p?i|tee\b|mv\b|cp\b|rm\b|mkdir\b|touch\b|patch\b|git\s+apply|python3?\s+-\s*<<|cat\s*>|cat\s*<<[^>]*>)|>\s*[\w./-]+\.\w+/.test(cmd)) return 'Implement'
  if (/(^|[\s;&|(])(cat|head|tail|less|sed\s+-n|grep|rg|find|ls|awk|wc|tree|git\s+(log|show|diff|status|grep|blame))\b/.test(cmd)) return 'Explore'
  return ''
}
// An agent's last step, as its log line says it ("Bash cd /x && npm test", "Edit /a/b.ts"), in plain words
export function stepWords(line?: string) {
  if (!line) return 'starting'
  const sp = line.indexOf(' ')
  const tool = sp < 0 ? line : line.slice(0, sp)
  const rest = sp < 0 ? '' : line.slice(sp + 1).trim()
  const file = base(rest)
  if (tool === 'Read') return `Reading ${file}`
  if (tool === 'Write') return `Writing ${file}`
  if (isEditTool(tool)) return `Editing ${file}`
  if (tool === 'Grep' || tool === 'Glob') return `Searching ${rest.slice(0, 40)}`
  if (tool === 'Bash') {
    const cmd = rest.replace(/^(cd\s+\S+\s*&&\s*)+/, '')
    if (TESTS.test(cmd) || /plugin test/.test(cmd)) return 'Running the tests'
    if (/\btsc\b/.test(cmd)) return 'Type-checking'
    return `Running ${cmd.split(/\s+/).slice(0, 3).join(' ').slice(0, 40)}`
  }
  if (tool === 'Agent' || tool === 'Task') return 'Starting a subagent'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'Reading the web'
  return `Using ${tool}`
}
