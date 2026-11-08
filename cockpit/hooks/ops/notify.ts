import { atom, read } from 'claude-code'

import type { Agent, SessionSpend } from '../../types'
import { budgetLevel, dayOf, todaySpend } from '../spend'
import { set, toast } from './core'
import { INITIAL, PANE } from '../state'
import type { $ } from './core'

// Telling you when work is done, while you are not watching: one notice per finish, through Claude Code's own
// notification channel (ui.notify), in words made from what Cockpit already knows
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-23' })

export type Finish =
  | { kind: 'turn'; task: string; files: number; add: number; del: number; tests?: { pass: number; total: number } }
  | { kind: 'agent'; agent: Pick<Agent, 'name' | 'status' | 'report' | 'cases' | 'worktree'> }
  | { kind: 'pipeline'; label: string; passed: boolean; failing?: string }
  | { kind: 'budget'; level: 'near' | 'over'; spend: number; budget: number }
  | { kind: 'agents'; agents: Pick<Agent, 'name' | 'status' | 'report' | 'cases' | 'worktree'>[] }
  | { kind: 'cycle'; cycle: number; ticked: number; total: number; spent: number; ended?: 'paused' | 'done' | 'stopped' }

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const cut = (t: string, n = 120) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

// What a finish says: a title and one line
export function doneText(f: Finish): { title: string; text: string } {
  if (f.kind === 'turn') {
    const changed = f.files ? `${plural(f.files, 'file')} +${f.add} −${f.del}` : 'no files changed'
    const tests = f.tests ? ` · tests ${f.tests.pass}/${f.tests.total}` : ''
    return { title: 'Claude is done', text: cut(`${f.task} · ${changed}${tests}`) }
  }
  if (f.kind === 'agent') {
    const a = f.agent
    const passed = a.cases.filter(c => c.st === 'pass' || c.st === 'fixed').length
    // What it found: its REPORT line (the stored report also holds its HANDOFF)
    const found = (a.report.match(/REPORT:\s*(.+)/)?.[1] ?? a.report.split('\n')[0] ?? '').trim()
    const said = a.cases.length ? `${passed}/${a.cases.length} passed` : found || (a.status === 'done' ? 'done' : a.status)
    const back = a.worktree?.files?.length && !a.worktree.back && !a.worktree.removed ? ` · Bring back ready: ${plural(a.worktree.files.length, 'file')} +${a.worktree.add ?? 0} −${a.worktree.del ?? 0}` : ''
    return { title: `${a.name} ${a.status === 'done' ? 'finished' : a.status}`, text: cut(`${said}${back}`) }
  }
  // Several agents that ran together: one notice when the last is done, naming each and what it said
  if (f.kind === 'agents') return { title: `${f.agents.length} agents finished`, text: cut(f.agents.map(a => `${a.name}: ${doneText({ kind: 'agent', agent: a }).text}`).join(' · '), 200) }
  if (f.kind === 'budget') return { title: f.level === 'over' ? 'Daily budget reached' : 'Daily budget at 80%', text: `$${f.spend.toFixed(2)} of $${f.budget.toFixed(2)} spent today (estimates); nothing is stopped` }
  if (f.kind === 'pipeline') return { title: `${f.label} finished`, text: f.passed ? 'All checks passed' : `Failed${f.failing ? `: ${cut(f.failing, 100)}` : ''}` }
  return { title: f.ended ? `Autopilot ${f.ended === 'done' ? 'done' : f.ended} after cycle ${f.cycle}` : `Autopilot cycle ${f.cycle} done`, text: `${f.ticked} of ${f.total} milestones ticked · $${f.spent.toFixed(2)} spent` }
}

// Sends a finish's notice once (by key), while the setting is on and you are not watching: the Cockpit pane is not
// on screen (isShown; isFocused would count it unwatched whenever you type in the prompt beside it)
const told = new Set<string>()
export async function tellDone($: $, key: string, f: Finish, opt: { always?: boolean } = {}) {
  if ((await read($, S)).notifyDone === false || told.has(key)) return
  told.add(key)
  // A warning is sent whether or not you are watching; a finish only while you are not
  const watching = !opt.always && (await $.ui.panes().catch(() => [])).some(p => p.id === PANE && p.isPlaced && p.isShown)
  if (watching) return
  const { title, text } = doneText(f)
  await $.ui.notify(text, { title }).catch(() => null)
}

// The daily budget, checked after each turn: crossing 80% and then 100% of it warns once each a day (kept across
// sessions with the settings), through the notices, whatever the pane shows. A budget only warns; nothing is stopped
const RANK = { none: 0, ok: 0, near: 1, over: 2 } as const
export async function checkBudget($: $, sessions: SessionSpend[], now: number) {
  const s = await read($, S)
  const spend = todaySpend(sessions, now)
  const level = budgetLevel(spend, s.dailyBudget)
  if (level !== 'near' && level !== 'over') return
  const day = dayOf(now)
  const was = s.budgetWarned?.day === day ? RANK[s.budgetWarned.level] : 0
  if (RANK[level] <= was) return
  await set($, { budgetWarned: { day, level } })
  await tellDone($, `budget:${day}:${level}`, { kind: 'budget', level, spend, budget: s.dailyBudget! }, { always: true })
}

// A daily budget typed in the Overview: dollars above 0, or left as it was with a word why
export async function setBudget($: $, text: string) {
  const usd = Number(String(text).trim().replace(/^\$/, ''))
  if (!Number.isFinite(usd) || usd <= 0) return toast($, 'A daily budget is a number of dollars above 0')
  await set($, st => ({ dailyBudget: Math.round(usd * 100) / 100, ui: { ...st.ui, budgetText: undefined } }))
}
