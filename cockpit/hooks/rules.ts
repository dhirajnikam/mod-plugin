import type { McpRow } from '../types'

// Hooks, permission rules and instructions, as Claude Code keeps them: settings.json ("hooks", "permissions") and
// CLAUDE.md, for the repository and for the user. Pure: the Rules tab reads the files, these read and change their
// text, and every change keeps the rest of the file as it was

export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'SessionStart', 'SessionEnd', 'Notification', 'PreCompact']
export const PERM_KINDS = ['allow', 'ask', 'deny'] as const
export type PermKind = (typeof PERM_KINDS)[number]

type Json = Record<string, unknown>
type HookGroup = { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] }

// A settings file's text: its object, or why it cannot be changed safely (it is then shown, never written)
export function parseSettings(text: string): { json: Json; error: string } {
  if (!text.trim()) return { json: {}, error: '' }
  try {
    const j = JSON.parse(text)
    return j && typeof j === 'object' && !Array.isArray(j) ? { json: j as Json, error: '' } : { json: {}, error: 'not a JSON object' }
  } catch (e) {
    return { json: {}, error: `not valid JSON: ${String((e as Error).message ?? e).slice(0, 120)}` }
  }
}
export const settingsText = (j: Json) => `${JSON.stringify(j, null, 2)}\n`

// Every command hook as a row: its event, its matcher, its command, and where it sits
export type HookRow = { key: string; event: string; matcher: string; command: string; group: number; index: number }
export function hookRows(j: Json): HookRow[] {
  const hooks = (j.hooks ?? {}) as Record<string, HookGroup[]>
  return Object.entries(hooks).flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : []).flatMap((g, gi) =>
      (Array.isArray(g.hooks) ? g.hooks : []).map((h, hi) => ({ key: `${event}/${gi}/${hi}`, event, matcher: g.matcher ?? '', command: h.command ?? `(${h.type ?? 'hook'})`, group: gi, index: hi })),
    ),
  )
}

// Adds a command hook (into the group of the same matcher when there is one), changes one, or removes one; a group or
// an event left empty goes too
export function changeHook(j: Json, op: { add: { event: string; matcher: string; command: string } } | { edit: HookRow; matcher: string; command: string } | { remove: HookRow }): Json {
  const next = JSON.parse(JSON.stringify(j)) as Json
  const hooks = ((next.hooks ??= {}) as Record<string, HookGroup[]>)
  if ('add' in op) {
    const { event, matcher, command } = op.add
    const groups = (hooks[event] ??= [])
    const g = groups.find(x => (x.matcher ?? '') === matcher)
    const hook = { type: 'command', command }
    if (g) (g.hooks ??= []).push(hook)
    else groups.push({ ...(matcher ? { matcher } : {}), hooks: [hook] })
    return next
  }
  const row = 'edit' in op ? op.edit : op.remove
  const groups = hooks[row.event]
  const g = groups?.[row.group]
  // The file is read again before each change: one that moved since it was shown is left alone
  if (!groups || !g?.hooks?.[row.index] || (g.hooks[row.index]!.command ?? `(${g.hooks[row.index]!.type ?? 'hook'})`) !== row.command || (g.matcher ?? '') !== row.matcher) return j
  if ('edit' in op) {
    g.hooks[row.index] = { ...g.hooks[row.index], command: op.command }
    if (op.matcher !== (g.matcher ?? '')) {
      // A new matcher moves the hook to its own group, as Claude Code groups hooks by matcher
      const [h] = g.hooks.splice(row.index, 1)
      groups.push({ ...(op.matcher ? { matcher: op.matcher } : {}), hooks: [h!] })
    }
  } else g.hooks.splice(row.index, 1)
  hooks[row.event] = groups.filter(x => x.hooks?.length)
  if (!hooks[row.event]!.length) delete hooks[row.event]
  if (!Object.keys(hooks).length) delete next.hooks
  return next
}

export type PermRow = { key: string; kind: PermKind; rule: string; index: number }
export function permRows(j: Json): PermRow[] {
  const p = (j.permissions ?? {}) as Partial<Record<PermKind, unknown>>
  return PERM_KINDS.flatMap(kind => (Array.isArray(p[kind]) ? (p[kind] as unknown[]) : []).map((r, i) => ({ key: `${kind}/${i}`, kind, rule: String(r), index: i })))
}

// Adds a permission rule, changes one (its text or its kind), or removes one; a list left empty goes too
export function changePerm(j: Json, op: { add: { kind: PermKind; rule: string } } | { edit: PermRow; kind: PermKind; rule: string } | { remove: PermRow }): Json {
  const next = JSON.parse(JSON.stringify(j)) as Json
  const p = ((next.permissions ??= {}) as Record<string, unknown>)
  const list = (k: PermKind) => ((p[k] = Array.isArray(p[k]) ? p[k] : []) as string[])
  if ('add' in op) {
    if (!list(op.add.kind).includes(op.add.rule)) list(op.add.kind).push(op.add.rule)
  } else {
    const row = 'edit' in op ? op.edit : op.remove
    if (list(row.kind)[row.index] !== row.rule) return j
    list(row.kind).splice(row.index, 1)
    if ('edit' in op && !list(op.kind).includes(op.rule)) list(op.kind).push(op.rule)
  }
  for (const k of PERM_KINDS) if (Array.isArray(p[k]) && !(p[k] as unknown[]).length) delete p[k]
  if (!Object.keys(p).length) delete next.permissions
  return next
}

// CLAUDE.md's instructions: its bullet lines ("- …" or "* …"), each with its line number; the rest of the file stays
export type RuleLine = { key: string; line: number; text: string }
export function ruleLines(md: string): RuleLine[] {
  return md.split('\n').flatMap((l, i) => {
    const m = l.match(/^\s*[-*]\s+(.+?)\s*$/)
    return m ? [{ key: `l${i}`, line: i, text: m[1]! }] : []
  })
}
export function changeRule(md: string, op: { add: string } | { edit: RuleLine; text: string } | { remove: RuleLine }): string {
  const lines = md.split('\n')
  if ('add' in op) {
    const body = md.replace(/\s+$/, '')
    return `${body}${body ? '\n' : ''}- ${op.add.trim()}\n`
  }
  const row = 'edit' in op ? op.edit : op.remove
  const m = lines[row.line]?.match(/^(\s*[-*]\s+)(.+?)\s*$/)
  if (!m || m[2] !== row.text) return md
  if ('edit' in op) lines[row.line] = `${m[1]}${op.text.trim()}`
  else lines.splice(row.line, 1)
  return lines.join('\n')
}

// MCP servers, as Claude Code keeps them: the project's in .mcp.json, yours at the top of ~/.claude.json and this
// project's private ("local") ones under its entry there. A row says what each runs and whether it runs; env and
// headers hold tokens, so only their names are kept, never their values
export type McpScope = McpRow['scope']
type McpServer = { type?: string; command?: string; args?: unknown[]; url?: string; env?: Json; headers?: Json }
const obj = (x: unknown): Json => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Json) : {})
const names = (x: unknown) => (Array.isArray(x) ? x.map(String) : [])
// Whatever a config file holds is drawn: control characters (escapes, newlines) become spaces
const plain = (x: unknown) => String(x ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
export const mcpTarget = (sv: McpServer) => plain(sv.url ?? [sv.command ?? '', ...(Array.isArray(sv.args) ? sv.args : [])].join(' ').trim())

// What a target shows: tokens a URL or an argument can carry are masked (a URL's login and query values, KEY=value,
// the word after --token, --api-key or --header, and strings shaped like known tokens)
const MASK = '•••'
const SECRET_FLAG = /token|key|secret|auth|pass|bearer|header|credential/i
const TOKEN = /^(gh[pousr]_|github_pat_|sk-|xox[abpr]-|glpat-|AKIA|eyJ)[\w.-]{6,}$/
export function maskTarget(t: string) {
  return t
    .split(' ')
    .map((w, i, all) => {
      if (/^[a-z][\w+.-]*:\/\//i.test(w)) return w.replace(/\/\/[^/@\s]*@/, `//${MASK}@`).replace(/([?&][^=&#]+=)[^&#]*/g, `$1${MASK}`)
      if (TOKEN.test(w)) return MASK
      if (i > 0 && /^--?[\w-]+$/.test(all[i - 1]!) && SECRET_FLAG.test(all[i - 1]!)) return MASK
      const kv = w.match(/^(-{0,2}[\w.-]+)=(.+)$/)
      return kv ? `${kv[1]}=${MASK}` : w
    })
    .join(' ')
}

// Paths as ~/.claude.json keys them: forward slashes, no trailing one, the drive letter in either case
const pathKey = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').replace(/^([A-Za-z]):/, (_, d: string) => `${d.toLowerCase()}:`)

// mcp: .mcp.json; claude: ~/.claude.json; settings: the repository's settings.json and settings.local.json and yours;
// root: the repository
export function mcpRows(mcp: Json, claude: Json, settings: Json[], root: string): McpRow[] {
  const projects = obj(claude.projects)
  const project = obj(projects[Object.keys(projects).find(k => pathKey(k) === pathKey(root)) ?? ''])
  const all = [...settings, project]
  const off = new Set(all.flatMap(j => names(j.disabledMcpjsonServers)))
  const on = new Set(all.flatMap(j => names(j.enabledMcpjsonServers)))
  const allOn = all.some(j => j.enableAllProjectMcpServers === true)
  // Servers switched off with /mcp in this project, whatever their scope
  const muted = new Set(names(project.disabledMcpServers))
  // One name, one server: local wins over project, project over user; the others are hidden by it
  const taken = new Set<string>()
  const rows = (servers: unknown, scope: McpScope): McpRow[] =>
    Object.entries(obj(servers)).map(([name, raw]) => {
      const sv = obj(raw) as McpServer
      const kind = sv.type === 'sse' ? 'sse' : sv.type === 'http' || (!sv.command && sv.url) ? 'http' : 'stdio'
      const shown = mcpTarget(sv)
      const target = maskTarget(shown)
      const state = taken.has(name) ? 'shadowed' : muted.has(name) || (scope === 'project' && off.has(name)) ? 'off' : scope !== 'project' || allOn || on.has(name) ? 'on' : 'approval'
      taken.add(name)
      return { key: `${scope}/${name}`, name: plain(name), scope, kind, target, masked: target !== shown, secrets: [...Object.keys(obj(sv.env)), ...Object.keys(obj(sv.headers))].map(plain), state }
    })
  const local = rows(project.mcpServers, 'local')
  const shared = rows(mcp.mcpServers, 'project')
  return [...shared, ...local, ...rows(claude.mcpServers, 'user')]
}

// A server typed as one line: a URL is an HTTP server, anything else a command and its arguments
// ponytail: arguments split at spaces, no quoting; a server needing quoted arguments is edited in .mcp.json by hand
function serverOf(target: string): McpServer {
  const t = target.trim()
  if (/^https?:\/\//i.test(t)) return { type: 'http', url: t }
  const [command = '', ...args] = t.split(/\s+/)
  return { command, args }
}

// The names Claude Code accepts for a server; the object keys JSON treats specially are refused too
export const mcpNameOk = (n: string) => /^[A-Za-z0-9_-]{1,64}$/.test(n) && !['__proto__', 'constructor', 'prototype'].includes(n)

// Adds a server to .mcp.json, changes one's name or what it runs (its env, headers and other fields kept, and what it
// runs kept exactly when its text is not changed), or removes one, the servers kept in their order. A name already
// taken or not allowed is refused, a row that no longer matches the file is left alone, and an mcpServers that is
// not an object is never replaced
export function changeMcp(j: Json, op: { add: { name: string; target: string } } | { edit: McpRow; name: string; target: string } | { remove: McpRow }): Json {
  if (j.mcpServers !== undefined && (typeof j.mcpServers !== 'object' || j.mcpServers === null || Array.isArray(j.mcpServers))) return j
  const next = JSON.parse(JSON.stringify(j)) as Json
  const servers = obj(next.mcpServers)
  const has = (n: string) => Object.prototype.hasOwnProperty.call(servers, n)
  if ('add' in op) {
    const name = op.add.name.trim()
    if (!mcpNameOk(name) || !op.add.target.trim() || has(name)) return j
    next.mcpServers = { ...servers, [name]: serverOf(op.add.target) }
    return next
  }
  const row = 'edit' in op ? op.edit : op.remove
  // Only a server written as an object is changed: anything else in the file is left for you to fix by hand
  // The name as the file has it (a row's name is cleaned for drawing; its key keeps the original)
  const id = row.key.slice(row.key.indexOf('/') + 1)
  const raw = has(id) ? servers[id] : undefined
  const cur = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as McpServer) : undefined
  if (row.scope !== 'project' || !cur || maskTarget(mcpTarget(cur)) !== row.target) return j
  const entries = Object.entries(servers)
  if ('remove' in op) next.mcpServers = Object.fromEntries(entries.filter(([n]) => n !== id))
  else {
    const name = op.name.trim() || id
    if ((name !== id && (has(name) || !mcpNameOk(name))) || (row.masked && op.target.trim() && op.target.trim() !== row.target)) return j
    // Its text unchanged (or a masked one, never retyped): what it runs stays exactly as it is
    const typed = op.target.trim()
    const same = !typed || typed === row.target
    const { type: _t, command: _c, args: _a, url: _u, ...rest } = cur
    const server = same ? cur : { ...serverOf(typed), ...rest }
    next.mcpServers = Object.fromEntries(entries.map(([n, v]) => (n === id ? [name, server] : [n, v])))
  }
  if (!Object.keys(obj(next.mcpServers)).length) delete next.mcpServers
  return next
}
