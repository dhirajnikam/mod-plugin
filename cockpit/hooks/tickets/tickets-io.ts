import type { Ticket, Tickets, TicketSource } from '../../types'
import type { $ } from '../core/core'
import { set, look, setUi, toast, inBackground } from '../core/core'
import { repoRoot } from '../core/repos'
import { cut, plain } from '../core/text'
import { setGit } from '../git/git'
import type { Result } from './tickets'
import { EMPTY, SERVERS, SOURCES, TOOLS, textOf, jsonOf, unknownTool, jiraSite, jiraProjects, jql, jiraTickets, notionFound, dataSource, notionTickets, gitTicket, briefPrompt, parseBrief, savedOf } from './tickets'

// The Tickets tab's reading: Jira and Notion through their makers' own MCP servers, called with the session's own
// connection and sign-in. Only when the tab opens or a button is pressed, never at a session's start or on a timer;
// only tools that read; and what a server says is drawn, never run

// The engine follows $ only into function declarations, so every helper that takes it is one
function patch($: $, fn: (t: Tickets) => Partial<Tickets>) {
  return set($, s => {
    const t = s.tickets ?? EMPTY
    return { tickets: { ...t, ...fn(t) } }
  })
}
async function now($: $) {
  return (await look($)).tickets ?? EMPTY
}
const nameOf = (source: TicketSource) => SOURCES.find(([id]) => id === source)?.[1] ?? source
async function storeKey($: $) {
  return `tickets:${await repoRoot($)}`
}

// The sources the person pressed Connect for, on this machine: the tab connects them again when it opens
const ON = 'tickets:on'
// And those for which Cockpit's own server was the one used: only these join a session (register.tsx holds the rest
// back), so someone on the claude.ai connector never has a second server dialed beside it
const OWN = 'tickets:own'
export async function ownOn($: $): Promise<string[]> {
  const own = await $.store.get(OWN).catch(() => undefined)
  return Array.isArray(own) ? own.map(String) : []
}
// A server of the tracker this session already runs and is signed in to (the claude.ai connector, another plugin's,
// one of your own): the one whose tools the session lists, by the name $.mcp.call takes; '' when there is none
const PROBE: Record<TicketSource, readonly string[]> = { jira: TOOLS.sites, notion: ['notion-search', 'notion-fetch'] }
const CONNECTORS: Record<TicketSource, string> = { jira: 'claude.ai Atlassian', notion: 'claude.ai Notion' }
async function running($: $, source: TicketSource) {
  const tools = await $.tool.list().catch(() => [])
  for (const name of PROBE[source]) {
    const t = tools.find(x => x.mcp && x.name.startsWith('mcp__') && x.name.endsWith(`__${name}`))
    if (t) return t.name.slice(5, -(name.length + 2))
  }
  // Tools not listed until they are searched for: the claude.ai connector by its name
  const c = await $.mcp.connect(CONNECTORS[source]).catch(() => null)
  return c?.isConnected ? c.server : ''
}
export async function connected($: $): Promise<string[]> {
  const on = await $.store.get(ON).catch(() => undefined)
  return Array.isArray(on) ? on.map(String) : []
}

// Per repository, across sessions: its project, the tickets being worked on and what was explained of them
async function save($: $) {
  const { source, project, working, briefs } = await now($)
  await $.store.set(await storeKey($), { source, project, working, briefs }).catch(() => null)
}
// What was saved for this repository, read at a session's start and when the tab opens: no server is asked
export async function loadSaved($: $) {
  const saved = savedOf(await $.store.get(await storeKey($)).catch(() => undefined))
  await set($, s => {
    const { project: _, ...t } = s.tickets ?? EMPTY
    return { tickets: saved ? { ...t, ...saved } : { ...t, working: [], briefs: {} } }
  })
}

// One of a server's tools, by the first name it knows
async function ask($: $, server: string, names: readonly string[], args: Record<string, unknown>): Promise<Result> {
  let last: Result = { content: [{ type: 'text', text: 'no tool to ask' }], isError: true }
  for (const name of names) {
    last = await $.mcp.call(server, name, args).catch((e): Result => ({ content: [{ type: 'text', text: String((e as Error)?.message ?? e) }], isError: true }))
    if (!last.isError || !unknownTool(textOf(last))) return last
  }
  return last
}
const why = (r: Result) => cut(plain(textOf(r)).trim() || 'the server gave no reason', 200)
// A press's reading, running past the press, one at a time
function bg($: $, label: string, work: () => Promise<unknown>) {
  return inBackground($, 'tickets', label, work)
}

function refused($: $, source: TicketSource, text: string) {
  return patch($, t => ({ conn: { ...t.conn, [source]: { why: text } } }))
}
// Connect: a server of the tracker you are already signed in to is used as it is; else Cockpit's own joins the
// session. For Jira its site is found. With no sign-in anywhere, the tab says how to give one
export function connect($: $, source: TicketSource) {
  bg($, `Connecting ${nameOf(source)}`, async () => {
    await $.store.set(ON, [...new Set([...(await connected($)), source])]).catch(() => null)
    let server = await running($, source)
    if (!server) {
      await $.store.set(OWN, [...new Set([...(await ownOn($)), source])]).catch(() => null)
      const c = await $.mcp.connect(SERVERS[source])
      if (!c.isConnected) return refused($, source, c.reason === 'auth' ? `No ${nameOf(source)} server is signed in: run /mcp, sign in to one (${CONNECTORS[source]}, or Cockpit's own), then press Connect again` : c.message)
      server = c.server
    }
    const c = { server }
    let site = {}
    if (source === 'jira') {
      const r = await ask($, c.server, TOOLS.sites, {})
      const found = r.isError ? null : jiraSite(jsonOf(r))
      if (!found) return refused($, source, r.isError ? `Jira: ${why(r)}` : 'Jira named no site this account can open')
      site = found
    }
    await patch($, t => ({ conn: { ...t.conn, [source]: { server: c.server, ...site } }, error: '' }))
    await read($)
  })
}

// The projects to pick from: Jira's own list, or what a Notion search for the typed words finds
async function readProjects($: $, find = '') {
  const t = await now($)
  const c = t.conn[t.source]
  if (!c?.server) return
  if (t.source === 'notion' && !find.trim()) return patch($, () => ({ projects: [] }))
  const r = t.source === 'jira' ? await ask($, c.server, TOOLS.projects, { cloudId: c.site }) : await ask($, c.server, TOOLS.search, { query: find.trim(), query_type: 'internal' })
  const projects = r.isError ? [] : t.source === 'jira' ? jiraProjects(jsonOf(r)) : notionFound(jsonOf(r))
  await patch($, () => ({ projects, error: r.isError ? why(r) : projects.length ? '' : `${nameOf(t.source)} found nothing` }))
}
// The project's open tickets: yours, or everyone's
async function readItems($: $) {
  const s = await look($)
  const t = s.tickets ?? EMPTY
  const c = t.conn[t.source]
  const p = t.project
  if (!c?.server || p?.source !== t.source) return
  let r: Result
  if (t.source === 'jira') r = await ask($, c.server, TOOLS.issues, { cloudId: c.site, jql: jql(p.id, !!s.ui.ticketAll), fields: ['summary', 'status', 'description'], maxResults: 30 })
  else {
    r = await ask($, c.server, TOOLS.rows, { mode: 'rows', data_source_url: p.id, limit: 30 })
    // A server without the rows tool, or a project that is no database: its pages by search
    if (r.isError) r = await ask($, c.server, TOOLS.search, { query: p.name, query_type: 'internal', data_source_url: p.id })
  }
  const items = r.isError ? [] : t.source === 'jira' ? jiraTickets(jsonOf(r), c.siteUrl ?? '') : notionTickets(jsonOf(r))
  await patch($, () => ({ items, error: r.isError ? why(r) : '' }))
}
// What the tab shows for the source it is on: its project's tickets, else the projects to pick one from
async function read($: $) {
  const t = await now($)
  return t.project?.source === t.source ? readItems($) : readProjects($)
}
export function refresh($: $) {
  return bg($, 'Reading tickets', () => read($))
}
export function findProjects($: $, text: string) {
  return bg($, 'Searching Notion', () => readProjects($, text))
}

// The tab opens: what was saved, and a source connected before is connected again
export async function loadTickets($: $) {
  await loadSaved($)
  const t = await now($)
  if (!t.conn[t.source] && (await connected($)).includes(t.source)) connect($, t.source)
}

// Forget a source: its server stays out of the next sessions until Connect is pressed again. What was saved for the
// repository stays
export async function forget($: $, source: TicketSource) {
  await $.store.set(ON, (await connected($)).filter(x => x !== source)).catch(() => null)
  await $.store.set(OWN, (await ownOn($)).filter(x => x !== source)).catch(() => null)
  await set($, s => {
    const t = s.tickets ?? EMPTY
    const { [source]: _, ...conn } = t.conn
    return { tickets: { ...t, conn, ...(t.source === source ? { projects: [], items: [] } : {}) } }
  })
}

export async function setSource($: $, source: TicketSource) {
  await patch($, () => ({ source, projects: [], items: [], error: '' }))
  await save($)
  const t = await now($)
  if (t.conn[source]?.server) refresh($)
  else if (!t.conn[source] && (await connected($)).includes(source)) connect($, source)
}

// This repository is for that project. A Notion database's rows are asked for by its data source, which it names
export function pickProject($: $, p: { id: string; name: string }) {
  bg($, 'Reading tickets', async () => {
    const t = await now($)
    const c = t.conn[t.source]
    let id = p.id
    if (t.source === 'notion' && c?.server) {
      const r = await ask($, c.server, TOOLS.fetch, { id: p.id })
      id = (!r.isError && dataSource(textOf(r))) || p.id
    }
    await patch($, () => ({ project: { source: t.source, id, name: p.name }, projects: [], items: [] }))
    await save($)
    await readItems($)
  })
}
export async function clearProject($: $) {
  await set($, s => {
    const { project: _, ...t } = s.tickets ?? EMPTY
    return { tickets: { ...t, items: [] } }
  })
  await save($)
  refresh($)
}

const ticketOf = (t: Tickets, id: string) => t.items.find(x => x.id === id) ?? t.working.find(x => x.id === id)
const withText = (list: Ticket[], id: string, text: string) => list.map(x => (x.id === id ? { ...x, text } : x))
// A Notion page's words, read when it is first opened or explained (Jira's come with its list)
async function readText($: $, id: string) {
  const t = await now($)
  const tk = ticketOf(t, id)
  const server = t.conn.notion?.server
  if (!tk || tk.source !== 'notion' || tk.text || !server) return
  const r = await ask($, server, TOOLS.fetch, { id })
  if (r.isError) return patch($, () => ({ error: why(r) }))
  const json = jsonOf(r) as { text?: unknown } | null
  const text = cut(plain(typeof json?.text === 'string' ? json.text : textOf(r)).replace(/\s+/g, ' ').trim(), 4000)
  await patch($, x => ({ items: withText(x.items, id, text), working: withText(x.working, id, text) }))
}
export async function openTicket($: $, id: string) {
  const open = (await look($)).ui.ticketOpen === id
  await setUi($, { ticketOpen: open ? '' : id })
  // Only a Notion page not read yet has anything to fetch: a press that fetches nothing must not hold the lock an
  // Explain pressed next would wait on
  const tk = ticketOf(await now($), id)
  if (!open && tk?.source === 'notion' && !tk.text) bg($, 'Reading the ticket', () => readText($, id))
}

// Explain: a model says what the ticket asks for and which features of the codebase memory it touches
export function explain($: $, id: string) {
  bg($, 'Explaining the ticket', async () => {
    await readText($, id)
    const s = await look($)
    const tk = ticketOf(s.tickets ?? EMPTY, id)
    if (!tk) return
    const features = s.memory.features ?? []
    // privacy: ticket-explain (docs/privacy.md lists what it sends)
    const r = await $.model.complete({ model: 'haiku', maxTokens: 700, system: 'You explain tickets to the developer about to work on them. Answer with one JSON object and nothing else.', prompt: briefPrompt(tk, features) })
    const brief = r.isAnswered ? parseBrief(r.text, features) : null
    if (!brief) return toast($, `Could not explain it: ${r.isAnswered ? 'the answer came back unreadable' : r.reason}`)
    await patch($, t => ({ briefs: { ...t.briefs, [id]: brief } }))
    await save($)
  })
}

// Working on a ticket, or no longer: kept for this repository, and the first with a key is the Git tab's ticket, so
// the branch and commit patterns carry it
export async function workOn($: $, id: string) {
  const t = await now($)
  const tk = ticketOf(t, id)
  if (!tk) return
  const was = t.working.some(x => x.id === id)
  const working = was ? t.working.filter(x => x.id !== id) : [...t.working, tk]
  await patch($, () => ({ working }))
  await save($)
  const key = gitTicket(working)
  if (key || (was && tk.key && (await look($)).git.ticket === tk.key)) await setGit($, { ticket: key })
}
