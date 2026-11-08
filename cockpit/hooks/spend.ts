// What each session spent, kept in .cockpit/history.json across sessions, and read back as spend by day and the
// costliest sessions. Claude Code tells a plugin a session's start, its cost so far in dollars (as /cost totals it)
// and its context tokens; there is no running total of tokens, so a session keeps its context tokens at its last turn.
// The figures are Claude Code's own estimates, not a bill

import type { SessionSpend } from '../types'

export type { SessionSpend }

// One record per session, by its start: a session's later figures replace its earlier ones in place, its dollars and
// turns never going down (clearing the finished flows, or a resume that counts afresh, loses none); the newest 200
export function upsertSession(list: SessionSpend[], s: SessionSpend, keep = 200): SessionSpend[] {
  const was = list.find(x => x.id === s.id)
  const rest = list.filter(x => x.id !== s.id)
  const next = was ? { ...s, usd: Math.max(s.usd, was.usd), turns: Math.max(s.turns, was.turns), endedAt: Math.max(s.endedAt, was.endedAt) } : s
  return [...rest, next].sort((a, b) => a.startedAt - b.startedAt).slice(-keep)
}

// A day as people read it: the date where you are
export const dayOf = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The last `days` days up to today, oldest first: each its date, its dollars and its sessions, a day with none at $0.
// A session counts on the day it started
export function spendByDay(list: SessionSpend[], now: number, days = 14): { day: string; usd: number; sessions: number }[] {
  const out: { day: string; usd: number; sessions: number }[] = []
  const today = new Date(now)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    out.push({ day: dayOf(d.getTime()), usd: 0, sessions: 0 })
  }
  const at = new Map(out.map(x => [x.day, x]))
  for (const s of list) {
    const row = at.get(dayOf(s.startedAt))
    if (row) {
      row.usd += s.usd
      row.sessions++
    }
  }
  return out
}

// The dearest sessions, newest first where two cost the same
export function costliest(list: SessionSpend[], n = 5): SessionSpend[] {
  return [...list].sort((a, b) => b.usd - a.usd || b.startedAt - a.startedAt).slice(0, n)
}

// Today's dollars: the sessions that started today, as the history keeps them
export const todaySpend = (list: SessionSpend[], now: number) => spendByDay(list, now, 1)[0]?.usd ?? 0

// Where today's spend stands against a daily budget: none (no budget, or not a positive one), ok, near (80% or more),
// over (100% or more). A budget only warns; nothing is ever blocked
export type BudgetLevel = 'none' | 'ok' | 'near' | 'over'
export function budgetLevel(spend: number, budget: number | undefined): BudgetLevel {
  if (!budget || !Number.isFinite(budget) || budget <= 0) return 'none'
  return spend >= budget ? 'over' : spend >= budget * 0.8 ? 'near' : 'ok'
}

// Every session's spend as it stands now: the earlier ones, and this one with its live figures
export function withCurrent(past: SessionSpend[] | undefined, at: number | undefined, now: number, usd: number, tokens: number, turns: number): SessionSpend[] {
  return at ? upsertSession(past ?? [], { id: `s${at}`, startedAt: at, endedAt: now, usd: Math.max(0, Number.isFinite(usd) ? usd : 0), tokens, turns }) : (past ?? [])
}
