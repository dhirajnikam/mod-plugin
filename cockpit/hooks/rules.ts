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

// mcp: .mcp.json; claude: ~/.claude.json; settings: the repository's and your settings.json; root: the repository
export function mcpRows(mcp: Json, claude: Json, settings: Json[], root: string): McpRow[] {
  const project = obj(obj(claude.projects)[root])
  const all = [...settings, project]
  const off = new Set(all.flatMap(j => names(j.disabledMcpjsonServers)))
  const on = new Set(all.flatMap(j => names(j.enabledMcpjsonServers)))
  const allOn = all.some(j => j.enableAllProjectMcpServers === true)
  // Servers switched off with /mcp in this project, whatever their scope
  const muted = new Set(names(project.disabledMcpServers))
  const rows = (servers: unknown, scope: McpScope): McpRow[] =>
    Object.entries(obj(servers)).map(([name, raw]) => {
      const sv = obj(raw) as McpServer
      const kind = sv.type === 'sse' ? 'sse' : sv.type === 'http' || (!sv.command && sv.url) ? 'http' : 'stdio'
      const state = muted.has(name) || (scope === 'project' && off.has(name)) ? 'off' : scope !== 'project' || allOn || on.has(name) ? 'on' : 'approval'
      return { key: `${scope}/${name}`, name: plain(name), scope, kind, target: mcpTarget(sv), secrets: [...Object.keys(obj(sv.env)), ...Object.keys(obj(sv.headers))].map(plain), state }
    })
  return [...rows(mcp.mcpServers, 'project'), ...rows(project.mcpServers, 'local'), ...rows(claude.mcpServers, 'user')]
}

// A server typed as one line: a URL is an HTTP server, anything else a command and its arguments
// ponytail: arguments split at spaces, no quoting; a server needing quoted arguments is edited in .mcp.json by hand
function serverOf(target: string): McpServer {
  const t = target.trim()
  if (/^https?:\/\//i.test(t)) return { type: 'http', url: t }
  const [command = '', ...args] = t.split(/\s+/)
  return { command, args }
}

// Adds a server to .mcp.json, changes one's name or what it runs (its env, headers and other fields kept), or
// removes one. A name already taken is not overwritten, and a row that no longer matches the file is left alone
export function changeMcp(j: Json, op: { add: { name: string; target: string } } | { edit: McpRow; name: string; target: string } | { remove: McpRow }): Json {
  const next = JSON.parse(JSON.stringify(j)) as Json
  const servers = obj((next.mcpServers ??= {}))
  next.mcpServers = servers
  if ('add' in op) {
    const name = op.add.name.trim()
    if (!name || !op.add.target.trim() || name in servers) return j
    servers[name] = serverOf(op.add.target)
    return next
  }
  const row = 'edit' in op ? op.edit : op.remove
  const cur = servers[row.name] as McpServer | undefined
  if (row.scope !== 'project' || !cur || mcpTarget(cur) !== row.target) return j
  if ('remove' in op) delete servers[row.name]
  else {
    const name = op.name.trim() || row.name
    if (name !== row.name && name in servers) return j
    // What it runs is replaced; the rest of the server (env, headers, timeouts) stays
    const { type: _t, command: _c, args: _a, url: _u, ...rest } = cur
    delete servers[row.name]
    servers[name] = { ...serverOf(op.target.trim() || row.target), ...rest }
  }
  if (!Object.keys(servers).length) delete next.mcpServers
  return next
}
