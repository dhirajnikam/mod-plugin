import type { Agent, SessionSpend, Flow, Commit } from '../../types'
import type { $ } from './core'
import { set, look } from './core'
import { cockpitDir } from './repos'
import { upsertSession, withCurrent } from './spend'

export const summary = (a: Agent): Agent => ({ ...a, log: [], prompt: '' })

// Session records a file holds that can be read: an id, a start, and dollars that are a real, non-negative number
function validSessions(x: unknown): SessionSpend[] {
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
  return (Array.isArray(x) ? x : []).filter((r): r is SessionSpend => !!r && typeof r.id === 'string' && ok(r.startedAt) && ok(r.endedAt) && ok(r.usd) && ok(r.tokens) && ok(r.turns))
}

// The repository's history: every finished flow and agent run, and Cockpit's commits, across sessions
export async function saveHistory($: $) {
  const dir = await cockpitDir($)
  if (!dir) return
  const s = await look($)
  const flows = [...s.past, ...s.flows.filter(f => f.status !== 'running')]
  const agents = [...s.pastAgents, ...s.agents.filter(a => a.status !== 'running').map(summary)]
  const dedupe = <T extends { id: string }>(xs: T[]) => [...new Map(xs.map(x => [x.id, x])).values()]
  const now = await $.clock.now()
  // This session's spend, kept in place under its start beside the earlier ones; the file is read again first, so
  // another session working in this repository at the same time keeps the records it wrote meanwhile
  const onDisk = await $.fs.read(`${dir}/history.json`).then(t => validSessions((JSON.parse(String(t)) as { sessions?: unknown }).sessions)).catch(() => [] as SessionSpend[])
  const known = onDisk.reduce((acc, x) => upsertSession(acc, x), s.pastSessions ?? [])
  const mine = s.sessionAt ? `s${s.sessionAt}` : ''
  const sessions = mine ? withCurrent(known.filter(x => x.id !== mine), s.sessionAt, now, s.cost, s.ctx.used, s.flows.length) : known
  const data = { version: 1, savedAt: now, flows: dedupe(flows).slice(-200), agents: dedupe(agents).slice(-100), commits: s.commits.slice(0, 50), sessions }
  // A history that cannot be written is tried again at the next save: it must never fail the turn
  await $.fs.write(`${dir}/history.json`, JSON.stringify(data, null, 1)).catch(() => null)
  // What other sessions wrote meanwhile shows here too
  await set($, { pastSessions: sessions.filter(x => x.id !== mine) })
}

export async function loadHistory($: $) {
  const dir = await cockpitDir($)
  if (!dir) return
  const text = await $.fs.read(`${dir}/history.json`).catch(() => '')
  if (!text) return
  try {
    const d = JSON.parse(text) as { flows?: Flow[]; agents?: Agent[]; commits?: Commit[]; sessions?: SessionSpend[] }
    await set($, s => ({
      past: (d.flows ?? []).filter(f => !s.flows.some(x => x.id === f.id)),
      pastAgents: (d.agents ?? []).filter(a => !s.agents.some(x => x.id === a.id)),
      commits: [...s.commits, ...(d.commits ?? []).filter(c => !s.commits.some(x => x.sha === c.sha))].slice(0, 50),
      // Earlier sessions' spend; this one's own record is rewritten from the live figures at each save
      pastSessions: validSessions(d.sessions),
    }))
  } catch {
    // A history file that does not parse is left as it is and read as empty
  }
}
