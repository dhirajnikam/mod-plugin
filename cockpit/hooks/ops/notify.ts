import { atom, read } from 'claude-code'

import type { Agent } from '../../types'
import { INITIAL, PANE } from '../state'
import type { $ } from './core'

// Telling you when work is done, while you are not watching: one notice per finish, through Claude Code's own
// notification channel (ui.notify), in words made from what Cockpit already knows
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-23' })

export type Finish =
  | { kind: 'turn'; task: string; files: number; add: number; del: number; tests?: { pass: number; total: number } }
  | { kind: 'agent'; agent: Pick<Agent, 'name' | 'status' | 'report' | 'cases' | 'worktree'> }
  | { kind: 'pipeline'; label: string; passed: boolean; failing?: string }
  | { kind: 'cycle'; cycle: number; ticked: number; total: number; spent: number }

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
  if (f.kind === 'pipeline') return { title: `${f.label} finished`, text: f.passed ? 'All checks passed' : `Failed${f.failing ? `: ${cut(f.failing, 100)}` : ''}` }
  return { title: `Autopilot cycle ${f.cycle} done`, text: `${f.ticked} of ${f.total} milestones ticked · $${f.spent.toFixed(2)} spent` }
}

// Sends a finish's notice once (by key), while the setting is on and you are not watching the Cockpit pane
const told = new Set<string>()
export async function tellDone($: $, key: string, f: Finish) {
  if ((await read($, S)).notifyDone === false || told.has(key)) return
  told.add(key)
  const watching = (await $.ui.panes().catch(() => [])).some(p => p.id === PANE && p.isPlaced && p.isFocused)
  if (watching) return
  const { title, text } = doneText(f)
  await $.ui.notify(text, { title }).catch(() => null)
}
