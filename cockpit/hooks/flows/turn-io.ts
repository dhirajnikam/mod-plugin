import type { Changed, FileOp, Ph } from '../../types'
import type { $ } from '../core/core'
import { look, set } from '../core/core'
import { saveHistory } from '../core/history'
import { tellDone, checkBudget } from '../core/notify'
import { repoRoot } from '../core/repos'
import { measure } from '../core/session'
import { sessionsNow } from '../core/spend'
import { syncAgents, startPipeline } from '../agents/agents'
import { verifyState } from '../agents/experts'
import { refreshRepo, followEdit, decideCommit } from '../git/git'
import { snapTurn } from '../git/turns-io'
import { stopAutopilot, autopilotTurnEnd } from '../judges/autopilot'
import { updateMemory, loadProject } from '../memory/memory-io'
import { flowOf } from './flows'
import { stepOf, activityOf, isEditTool } from './tools'

// The repository's changes as one text: a turn changed files when it differs at the turn's end, however the turn
// edited them (Edit and Write, a shell command, a script, a formatter)
export const changesOf = (c: { path: string; meta: string }[]) => c.map(x => `${x.path} ${x.meta}`).join('\n')

// The flow-opening half of a prompt: a new flow, the repo read first; returns its id and the repo's changes as they
// stood, to compare at the turn's end
export async function openFlow($: $, text: string, now: number) {
  await refreshRepo($)
  const changes = (await look($)).repo.changed
  const id = `f${now}`
  const task = text.trim().split('\n')[0] ?? ''
  await set($, s => ({
    task,
    turnStart: now,
    isWorking: true,
    activity: 'Reading the request',
    reached: ['Understand'],
    flows: [...s.flows.map(f => (f.status === 'running' ? { ...f, status: 'aborted' as const, endedAt: now } : f)), { id, task, startedAt: now, status: 'running' as const, reached: ['Understand'], ops: 0, add: 0, del: 0, decisions: 0, commit: '', costAt: s.cost }].slice(-30),
  }))
  return { id, changes }
}

// The flow openFlow opened, taken back for a prompt that was refused: no turn runs. was: the state before openFlow
// A flow that was running then, and that openFlow closed to open this one, runs again as it did
export function dropFlow($: $, id: string, was: Ph) {
  return set($, s => {
    const flows = s.flows
      .filter(f => f.id !== id)
      .map(f => {
        if (f.status !== 'aborted' || !was.flows.some(w => w.id === f.id && w.status === 'running')) return f
        const { endedAt: _, ...open } = f
        return { ...open, status: 'running' as const }
      })
    return { task: was.task, turnStart: was.turnStart, isWorking: was.isWorking && flows.at(-1)?.status === 'running', activity: was.activity, reached: was.reached, flows }
  })
}

// A turn that carries on the last flow: it runs again, one turn more, its plan and steps kept
export async function resumeFlow($: $, now: number) {
  await refreshRepo($)
  const changes = (await look($)).repo.changed
  await set($, s => {
    const f = s.flows[s.flows.length - 1]!
    const { endedAt: _, ...open } = f
    return { task: f.task, turnStart: now, isWorking: true, activity: 'Carrying on', reached: f.reached, flows: [...s.flows.slice(0, -1), { ...open, status: 'running' as const, turns: (f.turns ?? 1) + 1 }] }
  })
  return { changes }
}

// A main-loop tool call, as it starts: it drives the activity line, the file list and the running flow's steps
export function toolStarted($: $, tool: string, input: Record<string, unknown>, op: FileOp | null) {
  const step = stepOf(tool, input)
  return set($, s => ({
    activity: activityOf(tool, input),
    ...(op ? { ops: [...s.ops, op].slice(-200) } : {}),
    ...(step && !s.reached.includes(step) ? { reached: [...s.reached, step] } : {}),
    flows: s.flows.map((f, i) => (i === s.flows.length - 1 && f.status === 'running' ? { ...f, ops: f.ops + (op ? 1 : 0), add: f.add + (op?.add ?? 0), del: f.del + (op?.del ?? 0), reached: step && !f.reached.includes(step) ? [...f.reached, step] : f.reached } : f)),
  }))
}

// A main-loop tool call that was refused or failed: its first line is kept as the last error
export function toolFailed($: $, tool: string, deny: string | undefined, result: unknown, at: number) {
  const out = deny ? `refused: ${deny}` : typeof result === 'string' ? result : JSON.stringify(result ?? '')
  return set($, { lastError: { tool, text: out.trim().split('\n')[0]?.slice(0, 160) ?? '', at } })
}

// A main-loop tool call that went through: the codebase memory follows an edit, and the repo shown follows one made
// in another found repo
export async function toolDone($: $, tool: string, op: FileOp | null) {
  if (!op || !isEditTool(tool)) return
  await updateMemory($, op.path)
  if (op.path) await followEdit($, op.path).catch(() => null)
}

// The main loop's turn ended: its flow closes, the repo and the figures are read again, and what follows a turn
// runs (the autopilot's next cycle, a notice, the testers, the commit, the budget's warning).
// turn: what the hooks kept of it, namely whether a tool of its own edited a file, the repo's changes when it started
// (null: no prompt of this load started it) with each file's lines then, and the flow it started in
export async function mainTurnEnd($: $, e: { isAborted?: boolean | undefined; durationMs: number; answer?: string | undefined; turnId: string }, turn: { changed: boolean; atStart: string | null; linesWere: Changed[]; flow: string }) {
  const now = await $.clock.now()
  // Everything here is the flow's the turn started in. A prompt sent as the turn ended may already have opened the
  // next (and closed this one as stopped): that one's steps and its working mark are not this turn's to end
  const flowId = turn.flow || ((await look($)).flows.at(-1)?.id ?? '')
  await set($, st => {
    const isLast = st.flows.at(-1)?.id === flowId
    const mine = st.flows.find(f => f.id === flowId)
    const was = isLast ? st.reached : (mine?.reached ?? [])
    const reached = !e.isAborted && was.length && flowOf(isLast ? st.task : (mine?.task ?? ''), was, mine?.kind).steps.includes('Answer') && !was.includes('Answer') ? [...was, 'Answer'] : was
    return {
      // A question the person never answered (the turn was interrupted) waits no longer
      waiting: '',
      // The engine's own figure, the one the TurnDuration row is matched against
      lastTurnMs: e.durationMs,
      ...(isLast || st.flows.at(-1)?.status !== 'running' ? { isWorking: false, activity: 'Done' } : {}),
      ...(isLast ? { reached } : {}),
      flows: st.flows.map(f => (f.id === flowId && (f.status === 'running' || (!isLast && f.status === 'aborted')) ? { ...f, status: e.isAborted ? ('aborted' as const) : ('done' as const), endedAt: now, reached, ms: e.durationMs } : f)),
    }
  })
  await refreshRepo($)
  // The Activity tab's file list, as the turn left the project
  await loadProject($).catch(() => null)
  // The working tree as the turn left it, before any auto-commit
  await snapTurn($, flowId, 'after').catch(() => null)
  await measure($)
  await syncAgents($)
  const s = await look($)
  const didChange = turn.changed || (turn.atStart !== null && s.repo.changed.length > 0 && changesOf(s.repo.changed) !== turn.atStart)
  // The cycle this turn was, before the autopilot moves on to the next
  const endedCycle = s.autopilot?.status === 'running' ? s.autopilot.cycle : 0
  // The autopilot's next cycle, once this turn's figures are in (cost for its budget, changes for its stall count)
  // A failure here must not leave the run marked running with no next cycle: it pauses, saying why
  await autopilotTurnEnd($, e.answer ?? '', didChange, !!e.isAborted, s.turnStart).catch(err => stopAutopilot($, 'paused', `its turn's end failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`).catch(() => null))
  // Files a shell command or script changed reach the memory here
  if (didChange && s.repo.changed.length) {
    const root = await repoRoot($)
    for (const c of s.repo.changed.slice(0, 40)) await updateMemory($, `${root}/${c.path}`)
  }
  // The flow's +/− counts what changed in the repository this turn, a shell command's edits too: the lines each file
  // gained since the turn started, or the edits' own count where that is more
  // ponytail: git's numstat leaves untracked files out, so a new file a shell command wrote counts no lines
  if (didChange && turn.atStart !== null) {
    const was = new Map(turn.linesWere.map(c => [c.path, c]))
    const add = s.repo.changed.reduce((n, c) => n + Math.max(0, c.add - (was.get(c.path)?.add ?? 0)), 0)
    const del = s.repo.changed.reduce((n, c) => n + Math.max(0, c.del - (was.get(c.path)?.del ?? 0)), 0)
    await set($, st => ({ flows: st.flows.map(f => (f.id === flowId ? { ...f, add: Math.max(f.add, add), del: Math.max(f.del, del) } : f)) }))
  }
  // A notice while you are not watching: the autopilot's cycle while one runs, else the turn
  const now2 = await look($)
  const ap = now2.autopilot
  const fl = now2.flows.find(f => f.id === flowId)
  if (ap && endedCycle && !e.isAborted) await tellDone($, `cycle:${ap.at}:${endedCycle}`, { kind: 'cycle', cycle: endedCycle, ticked: ap.done, total: ap.total, spent: Math.max(0, now2.cost - ap.costAt), ...(ap.status !== 'running' ? { ended: ap.status } : {}) }).catch(() => null)
  else if (fl && !e.isAborted) {
    const vs = verifyState(now2.agents)
    await tellDone($, `turn:${flowId}:${e.turnId}`, { kind: 'turn', task: fl.task, files: now2.repo.changed.length, add: fl.add, del: fl.del, ...(vs.cases.length ? { tests: { pass: vs.pass, total: vs.cases.length } } : {}) }).catch(() => null)
  }
  const commitAfterTests = s.git.commitMode !== 'manual' && s.git.autoWhen === 'tests'
  if (didChange && (s.autoVerify || commitAfterTests)) await startPipeline($, 'verify')
  if (didChange && s.git.commitMode !== 'manual' && s.git.autoWhen !== 'tests') await decideCommit($)
  await saveHistory($)
  // The daily budget's warnings, once each a day
  const sb = await look($)
  const at = await $.clock.now()
  await checkBudget($, sessionsNow(sb, at), at).catch(() => null)
}
