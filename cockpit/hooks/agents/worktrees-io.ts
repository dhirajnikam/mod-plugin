import type { Agent } from '../../types'
import type { $ } from '../core/core'
import { look, set, toast } from '../core/core'
import { repoRoot } from '../core/repos'
import { firstLine, plural, slashed } from '../core/text'
import { refreshRepo } from '../git/git'
import { snapshot } from '../git/turns'
import { turnRun } from '../git/turns-io'
import { WORKTREE_COMMANDS, worktreeFor, worktreeRef, fillArgs, parseStat, C_LOCALE, applyRefusal, pickIsolated } from './worktrees'

// An agent's own worktree, made before it starts: from HEAD, under the git folder, on a branch of its own. Why not,
// when it cannot be made (no commit yet, the add refused), so the agent runs in your tree instead
async function makeWorktree($: $, id: string): Promise<{ path: string; branch: string; base: string } | { error: string }> {
  const run = await turnRun($)
  const root = (await repoRoot($)) || '.'
  const head = await run(WORKTREE_COMMANDS.head, {})
  if (head.exitCode !== 0 || !head.stdout.trim()) return { error: 'the repository has no commit yet' }
  const common = (await run(WORKTREE_COMMANDS.common, {})).stdout.trim()
  if (!common) return { error: 'git did not say where its folder is' }
  const at = /^([A-Za-z]:)?[\\/]/.test(common) ? common : `${root}/${common}`
  const w = worktreeFor(id, at)
  const base = head.stdout.trim()
  const add = await run(fillArgs(WORKTREE_COMMANDS.add, { branch: w.branch, path: w.path, base }), {})
  if (add.exitCode !== 0) return { error: `git worktree add failed: ${firstLine(add)}` }
  return { path: w.path, branch: w.branch, base }
}
// What a worktree agent changed: its worktree's files snapshotted with the turn plan run inside it, against the commit
// it started from. Cockpit's experts never commit, so the files are the work
export async function measureWorktree($: $, agentId: string) {
  // One Claude Code isolated: found first, if Cockpit has not yet
  const ag0 = (await look($)).agents.find(a => a.id === agentId)
  if (ag0?.worktree?.claude) await findIsolated($, agentId)
  const ag = (await look($)).agents.find(a => a.id === agentId)
  const w = ag?.worktree
  // A finished agent whose worktree never showed changed nothing: Claude Code dropped it, and there is nothing to bring back
  if (w?.claude && !w.path && ag && ag.status !== 'running') {
    await set($, s => ({ agents: s.agents.map(a => (a.id === agentId && a.worktree ? { ...a, worktree: { ...a.worktree, nothing: true, removed: true, before: undefined } } : a)) }))
    return null
  }
  if (!w || w.removed || !w.path) return null
  const snap = await snapshot(worktreeRef(w.path), await turnRun($, w.path))
  if (!snap.commit) return null
  const run = await turnRun($)
  const st = parseStat((await run(fillArgs(WORKTREE_COMMANDS.stat, { base: w.base, snap: snap.commit }), {})).stdout)
  await set($, s => ({ agents: s.agents.map(a => (a.id === agentId && a.worktree ? { ...a, worktree: { ...a.worktree, snap: snap.commit, files: st.files, add: st.add, del: st.del } } : a)) }))
  return { snap: snap.commit, ...st }
}
// Bring back, once you confirmed: the worktree's changes applied to your working tree's files (never the index), all or
// nothing; a clash with your own changes refuses, naming the files, and changes nothing
export async function bringBack($: $, agentId: string) {
  await set($, s => ({ ui: { ...s.ui, wtAsk: '' } }))
  const ag = (await look($)).agents.find(a => a.id === agentId)
  const w = ag?.worktree
  if (!w || w.removed) return toast($, 'That worktree is gone')
  if (ag.status === 'running') return toast($, 'Not brought back: the agent is still working')
  // Read afresh; a worktree that can no longer be read (deleted by hand) brings back what was last measured of it
  const m = (await measureWorktree($, agentId)) ?? (w.snap && w.files ? { snap: w.snap, files: w.files, add: w.add ?? 0, del: w.del ?? 0 } : null)
  if (!m) return toast($, 'Not brought back: its worktree could not be read')
  if (!m.files.length) return toast($, 'Nothing to bring back: the agent changed no files')
  const run = await turnRun($)
  const patch = (await run(fillArgs(WORKTREE_COMMANDS.diff, { base: w.base, snap: m.snap }), {})).stdout
  const check = await run(WORKTREE_COMMANDS.check, C_LOCALE, patch)
  if (check.exitCode !== 0) {
    const why = applyRefusal(check.stderr ?? '')
    return toast($, `Not brought back, nothing changed: ${why.length ? why.slice(0, 3).join(', ') + (why.length > 3 ? ` and ${why.length - 3} more` : '') : firstLine(check) || 'git apply refused it'}`)
  }
  const done = await run(WORKTREE_COMMANDS.apply, C_LOCALE, patch)
  if (done.exitCode !== 0) return toast($, `Not brought back: ${firstLine(done)}`)
  await set($, s => ({ agents: s.agents.map(a => (a.id === agentId && a.worktree ? { ...a, worktree: { ...a.worktree, back: true } } : a)) }))
  await refreshRepo($)
  await toast($, `Brought back: ${plural(m.files.length, 'file')} +${m.add} −${m.del} from ${w.branch}`)
}
// Remove, once you confirmed: the worktree goes (with anything in it not brought back), its branch stays
export async function removeWorktree($: $, agentId: string) {
  await set($, s => ({ ui: { ...s.ui, wtAsk: '' } }))
  const ag = (await look($)).agents.find(a => a.id === agentId)
  const w = ag?.worktree
  if (!w || w.removed) return
  if (ag.status === 'running') return toast($, 'Not removed: the agent is still working in it')
  const run = await turnRun($)
  const r = await run(fillArgs(WORKTREE_COMMANDS.remove, { path: w.path }), {})
  if (r.exitCode !== 0) {
    // Deleted by hand already: git's record of it is pruned, and once git lists it no more it counts as removed
    await run(WORKTREE_COMMANDS.prune, {})
    const listed = (await listWorktrees($)).some(x => x.path === slashed(w.path))
    if (listed) return toast($, `Not removed: ${firstLine(r)}`)
  }
  await set($, s => ({ agents: s.agents.map(a => (a.id === agentId && a.worktree ? { ...a, worktree: { ...a.worktree, removed: true } } : a)) }))
  await toast($, w.branch && w.branch !== '(detached)' ? `Worktree removed; its branch ${w.branch} is kept` : 'Worktree removed')
}
// A worktree made for a start that never happened: removed, and its branch with it. `branch -d` refuses a branch with a
// commit of its own, so nothing anyone made is lost
async function dropWorktree($: $, w: { path: string; branch: string }) {
  const run = await turnRun($)
  await run(fillArgs(WORKTREE_COMMANDS.remove, { path: w.path }), {})
  await run(fillArgs(WORKTREE_COMMANDS.dropBranch, { branch: w.branch }), {})
}
// The worktrees git knows of, with their branches (`git worktree list --porcelain`), paths with forward slashes and no
// slash at the end
async function listWorktrees($: $): Promise<{ path: string; branch: string; head: string }[]> {
  const run = await turnRun($)
  const out = (await run(WORKTREE_COMMANDS.list, {})).stdout
  return out.split(/\n\n+/).map(b => ({ path: slashed(b.match(/^worktree (.+)$/m)?.[1] ?? ''), branch: (b.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? ''), head: b.match(/^HEAD (\w+)$/m)?.[1] ?? '' })).filter(w => w.path)
}
// Before an isolated twin starts: the commit it starts from, and the worktrees there already, to tell its own from them
async function beforeIsolated($: $): Promise<{ base: string; before: string[] } | null> {
  const run = await turnRun($)
  const head = (await run(WORKTREE_COMMANDS.head, {})).stdout.trim()
  if (!head) return null
  return { base: head, before: (await listWorktrees($)).map(w => w.path) }
}
// The worktree Claude Code made for an agent: the one not there before it started; kept on the agent once found
async function findIsolated($: $, agentId: string) {
  const s0 = await look($)
  const w = s0.agents.find(a => a.id === agentId)?.worktree
  if (!w?.claude || w.path || !w.before) return w ?? null
  const claimed = s0.agents.filter(a => a.id !== agentId && a.worktree?.path).map(a => a.worktree!.path)
  const fresh = pickIsolated(await listWorktrees($), w.before, claimed)
  if (!fresh) return null
  // Its base is its own HEAD as Claude Code made it (the experts never commit), not this checkout's
  const found = { ...w, path: fresh.path, branch: fresh.branch || '(detached)', base: fresh.head || w.base, before: undefined }
  await set($, s => ({ agents: s.agents.map(a => (a.id === agentId ? { ...a, worktree: found } : a)) }))
  return found
}

// Claude Code's own worktree isolation lives on an agent's definition (`isolation: 'worktree'`), not on a start: so for
// each type Cockpit defines (its experts, the agents you made, a general-purpose one) it registers a twin that runs
// isolated, and a ticked start of that type starts the twin. Claude Code then makes the worktree; Cockpit finds it
const isolatedTwin = new Map<string, string>()
// And back: a twin's own type, so its row, its name, a pipeline's links and Rerun treat it as the agent it is
const twinOf = new Map<string, string>()
export function plainType(type: string) {
  return twinOf.get(type) ?? type
}
// A twin's definition: the agent's own, renamed and isolated
export function twinSpec<S extends { name: string; description: string }>(spec: S) {
  return { ...spec, name: `${spec.name}-in-worktree`, description: `${spec.description} (in a worktree of its own)`, isolation: 'worktree' as const }
}
export async function registerIsolated($: $, type: string, spec: { name: string; description: string; prompt: string; model?: string; tools?: readonly string[] }) {
  const r = await $.agent.register(twinSpec(spec)).catch(() => null)
  if (r?.agent) {
    isolatedTwin.set(type, r.agent)
    twinOf.set(r.agent, type)
  }
}

// How an agent's start gets its worktree: one Cockpit made (own), Claude Code's through the type's twin, or none
type Plan = { own: { path: string; branch: string; base: string } } | { twin: string; base: string; before: string[]; release: () => void } | null
// Twin starts one at a time: each one's before-list is taken, it starts, and its worktree is looked for, before the next.
// The caller gives the turn back with the plan's release()
let isolating: Promise<unknown> = Promise.resolve()
function takeIsolation(): Promise<() => void> {
  let release = () => {}
  const mine = new Promise<void>(res => (release = res))
  const turn = isolating.then(() => release)
  isolating = isolating.then(() => mine)
  return turn
}
// Counts the worktrees Cockpit made, for their ids
let worktrees = 0
// With "In its own worktree" ticked, the worktree an agent starts in: made from HEAD on a branch of its own; none (and
// a toast saying why) when it cannot be, so the agent runs in your tree. The id is the time and a count, never reused
export async function worktreeToRun($: $, type: string): Promise<Plan> {
  if (!(await look($)).ui.agentWorktree) return null
  // Claude Code's own isolation, through the type's isolated twin
  const twin = isolatedTwin.get(type)
  if (twin) {
    const release = await takeIsolation()
    const b = await beforeIsolated($).catch(() => null)
    if (b) return { twin, ...b, release }
    release()
    await toast($, 'Runs in your tree: the repository has no commit yet')
    return null
  }
  // A type Cockpit cannot redefine (another plugin's): a worktree Cockpit makes itself
  const wt = await makeWorktree($, `ag${await $.clock.now()}-${++worktrees}`).catch(e => ({ error: String(e) }))
  if ('error' in wt) {
    await toast($, `Runs in your tree: ${wt.error}`)
    return null
  }
  return { own: wt }
}
// Worktrees whose agent has no record yet, by the agent's id, or by the worktree's folder where the start gave no id
const pendingWorktrees = new Map<string, NonNullable<Agent['worktree']>>()
// Twins' worktrees whose start handed no id back, by twin type, oldest first: the twin's spawn event takes the next
const pendingTwins = new Map<string, NonNullable<Agent['worktree']>[]>()
// Twin agents whose spawn event came before their start could hand them a worktree, by twin type, oldest first
const unmatchedTwins = new Map<string, string[]>()
// A twin's worktree, made by Claude Code: nothing to undo on a refusal; otherwise the agent waits to have it found
async function keepIsolated($: $, id: string | null, plan: { twin: string; base: string; before: string[] }) {
  if (id === null) return
  const w = { path: '', branch: '', base: plan.base, claude: true, before: plan.before }
  // A start that hands no id back: a twin agent already seen without one takes it, else the twin's spawn event, by its
  // type, picks it up; two such starts queue
  if (!id) {
    const waiting = unmatchedTwins.get(plan.twin)?.shift()
    if (!waiting) return void pendingTwins.set(plan.twin, [...(pendingTwins.get(plan.twin) ?? []), w])
    id = waiting
  }
  if ((await look($)).agents.some(a => a.id === id)) await set($, s => ({ agents: s.agents.map(a => (a.id === id ? { ...a, worktree: w } : a)) }))
  else pendingWorktrees.set(id, w)
  await findIsolated($, id).catch(() => null)
}
// The folder each agent's spawn event named, for a worktree whose start handed no id back but whose event came first
const spawnedIn = new Map<string, string>()
// The agent it started for keeps it: by id, or, where the start hands no id back, by the folder its spawn event names;
// one whose record is not made yet gets it when it is. A start that was refused (null), or handed to Claude (who starts
// it in your tree), leaves no worktree or branch behind
export async function keepWorktree($: $, id: string | null, plan: Plan) {
  if (!plan) return
  if ('twin' in plan) return keepIsolated($, id, plan)
  const wt = plan.own
  if (id === null) return dropWorktree($, wt)
  const owner = id || spawnedIn.get(slashed(wt.path)) || ''
  if (owner && (await look($)).agents.some(a => a.id === owner)) await set($, s => ({ agents: s.agents.map(a => (a.id === owner ? { ...a, worktree: wt } : a)) }))
  else pendingWorktrees.set(owner || slashed(wt.path), wt)
}
// An agent's record is being made: the worktree that waits for it, if one does, by its id, by the folder its spawn
// named, or, for a new twin, the next queued for its type. A new twin with none waiting is noted, for its start to find
export function takeWorktree(a: { id: string; type: string; cwd?: string }, isNew: boolean) {
  if (a.cwd) spawnedIn.set(slashed(a.cwd), a.id)
  const key = pendingWorktrees.has(a.id) ? a.id : a.cwd && pendingWorktrees.has(slashed(a.cwd)) ? slashed(a.cwd) : ''
  const wt = key ? pendingWorktrees.get(key) : isNew ? pendingTwins.get(a.type)?.shift() : undefined
  if (key) pendingWorktrees.delete(key)
  if (isNew && !wt && twinOf.has(a.type)) unmatchedTwins.set(a.type, [...(unmatchedTwins.get(a.type) ?? []), a.id])
  return wt
}
