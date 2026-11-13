import type { $ } from '../core/core'
import { set, toast } from '../core/core'
import { repoRoot } from '../core/repos'
import { refreshRepo } from './git'
import type { Run } from './turns'
import { turnRef, snapshot, undoTurn, pruneTurns } from './turns'

// Runs a git command in the repository's top folder, or in `cwd` (an agent's worktree)
export async function turnRun($: $, cwd?: string): Promise<Run> {
  cwd ??= (await repoRoot($)) || '.'
  // ponytail: 30 s a command; a git that hangs (a lock, a huge add) fails the snapshot instead of holding every turn
  return (argv, env, stdin) => $.process.run(argv, { cwd, env, timeoutMs: 30_000, ...(stdin !== undefined ? { stdin } : {}) })
}

// One snapshot or undo at a time: they share the one temporary index
let snapping: Promise<unknown> = Promise.resolve()

// Turn snapshots (see turns.ts): the working tree before and after each turn, as Cockpit's own refs, so a turn can be
// undone whatever made its changes. A turn carried on in the same flow keeps its first before; a failure is quiet,
// since no turn may wait on or fail for it
export async function snapTurn($: $, flowId: string | undefined, which: 'before' | 'after') {
  const mine = snapping.then(() => snapTurnNow($, flowId, which))
  snapping = mine.catch(() => null)
  return mine
}
async function snapTurnNow($: $, flowId: string | undefined, which: 'before' | 'after') {
  if (!flowId) return
  const run = await turnRun($)
  const ref = turnRef(flowId, which)
  if (which === 'before' && (await run(['git', 'rev-parse', '--verify', '-q', ref], {})).exitCode === 0) return
  // Outside a repository the plan's first git command fails, and no snapshot is made
  const r = await snapshot(ref, run)
  if (!r.commit) return
  await set($, st => ({ flows: st.flows.map(f => (f.id === flowId ? { ...f, snap: { ...f.snap, [which]: true } } : f)) }))
  if (which === 'after') await pruneTurns(run)
}

// Undo this turn, once you confirmed: the turn's own changes undone, whatever made them, unless one of its files changed
// since it ended; the tree as it was just before is kept under its undone ref
export async function undoFlow($: $, flowId: string) {
  await set($, st => ({ ui: { ...st.ui, undoAsk: '' } }))
  const run = await turnRun($)
  // In the snapshots' queue: the undo's own snapshot shares their temporary index
  const mine = snapping.then(() => undoTurn(turnRef(flowId, 'before'), turnRef(flowId, 'after'), turnRef(flowId, 'undone'), run))
  snapping = mine.catch(() => null)
  const r = await mine
  if (r.refuse.length) return toast($, `Not undone: changed since that turn ended: ${r.refuse.slice(0, 3).join(', ')}${r.refuse.length > 3 ? ` and ${r.refuse.length - 3} more` : ''}`)
  if (!r.done) return toast($, `Not undone: ${r.error}`)
  await set($, st => ({ flows: st.flows.map(f => (f.id === flowId ? { ...f, snap: { ...f.snap, undone: true } } : f)) }))
  await refreshRepo($)
  const n = r.restore.length + r.remove.length
  await toast($, n ? `Undone: ${r.restore.length} restored, ${r.remove.length} removed · the files as they were just before: ${turnRef(flowId, 'undone')}` : 'That turn changed no files')
}
