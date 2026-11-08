// Turn snapshots: before and after each turn, the whole working tree (tracked and untracked files, .gitignore
// honoured) is kept as a commit under refs/cockpit/turns/<flow>/, so a turn can be undone whatever made its changes:
// Edit and Write, a shell command, a script, a subagent. The commit is built from a temporary index, so the working
// tree, the real index and every branch stay exactly as they are.

// The steps, as data: Cockpit runs them through $.process.run, and scripts/check_turn_undo.py reads this same list out
// of this file and runs it against a real repository, so the two cannot drift. Keep it valid JSON between the markers.
// out: keep the step's output under that name; when: run only if that name is set (or, with !, not set); index: on the
// temporary index; author: as Cockpit, so a repository with no user.name still gets its snapshot; optional: may fail
// plan:start
export const SNAPSHOT_PLAN = [
  { "out": "index", "run": ["git", "rev-parse", "--git-path", "cockpit-index"] },
  { "out": "head", "run": ["git", "rev-parse", "--verify", "-q", "HEAD"], "optional": true },
  { "when": "head", "run": ["git", "read-tree", "{head}"], "index": true },
  { "when": "!head", "run": ["git", "read-tree", "--empty"], "index": true },
  { "run": ["git", "add", "-A"], "index": true },
  { "out": "tree", "run": ["git", "write-tree"], "index": true },
  { "when": "head", "out": "commit", "run": ["git", "commit-tree", "{tree}", "-p", "{head}", "-m", "cockpit turn snapshot"], "author": true },
  { "when": "!head", "out": "commit", "run": ["git", "commit-tree", "{tree}", "-m", "cockpit turn snapshot"], "author": true },
  { "run": ["git", "update-ref", "{ref}", "{commit}"] }
]
// plan:end

// The commands undoing a turn runs, as data for the same reason. No file is put on a command line (none too long for a
// turn that touched thousands): `since` lists every change after the turn and the turn's own are picked from it, and
// restore reads its files on standard input, NUL between them, with GIT_LITERAL_PATHSPECS=1 so a file named with * or
// : is that file and no pattern. All run from the repository's top folder, where git's paths start
// undo:start
export const UNDO_COMMANDS = {
  "changed": ["git", "diff", "--name-status", "--no-renames", "-z", "{before}", "{after}"],
  "since": ["git", "diff", "--name-only", "--no-renames", "-z", "{after}", "{now}"],
  "restore": ["git", "restore", "--source={before}", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"]
}
// undo:end
export const LITERAL = { GIT_LITERAL_PATHSPECS: '1' }

type Step = { out?: string; run: string[]; when?: string; index?: boolean; author?: boolean; optional?: boolean }
export type Run = (argv: string[], env: Record<string, string>, stdin?: string) => Promise<{ exitCode: number; stdout: string; stderr?: string }>
export const AUTHOR = { GIT_AUTHOR_NAME: 'Cockpit', GIT_AUTHOR_EMAIL: 'cockpit@localhost', GIT_COMMITTER_NAME: 'Cockpit', GIT_COMMITTER_EMAIL: 'cockpit@localhost' }

// Runs the plan for one ref; the snapshot's commit, or why it could not be made
export async function snapshot(ref: string, run: Run): Promise<{ commit: string; error: string }> {
  const vars: Record<string, string> = { ref }
  const fill = (x: string) => x.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
  for (const step of SNAPSHOT_PLAN as Step[]) {
    if (step.when && (step.when.startsWith('!') ? !!vars[step.when.slice(1)] : !vars[step.when])) continue
    const env = { ...(step.index ? { GIT_INDEX_FILE: vars.index ?? '' } : {}), ...(step.author ? AUTHOR : {}) }
    const r = await run(step.run.map(fill), env).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
    if (r.exitCode !== 0 && !step.optional) return { commit: '', error: `${step.run.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout).trim().split('\n')[0] ?? ''}` }
    if (step.out) vars[step.out] = r.exitCode === 0 ? r.stdout.trim() : ''
  }
  return { commit: vars.commit ?? '', error: vars.commit ? '' : 'no snapshot was made' }
}

export const turnRef = (flow: string, which: 'before' | 'after' | 'undone') => `refs/cockpit/turns/${flow.replace(/[^\w-]/g, '_')}/${which}`

// What undoing a turn does, from `git diff --name-status --no-renames -z <before> <after>`: what the turn changed or
// deleted is restored from before, what it created is deleted. stale: `git diff --name-only --no-renames -z <after>
// <now> -- <those files>`, the ones changed since the turn ended; any, and nothing is done
export function undoPlan(nameStatus: string, stale: string): { restore: string[]; remove: string[]; refuse: string[] } {
  const parts = nameStatus.split('\0').filter(Boolean)
  const restore: string[] = []
  const remove: string[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [code, path] = [parts[i]!, parts[i + 1]!]
    if (code.startsWith('A')) remove.push(path)
    else restore.push(path)
  }
  const refuse = stale.split('\0').filter(Boolean)
  return refuse.length ? { restore: [], remove: [], refuse } : { restore, remove, refuse: [] }
}

// Undoes a turn: what it changed is read from its snapshots, the tree as it is now is kept as `undoneRef` (so the undo
// can be undone), and unless a file changed since the turn ended, what the turn created is deleted (and the folders that
// leaves empty) before the rest is restored, so a file that became a folder, or a folder a file, comes back too.
// remove deletes a file at a path from the top folder; rmdir removes a folder only if it is empty
export async function undoTurn(before: string, after: string, undoneRef: string, run: Run, remove: (path: string) => Promise<unknown>, rmdir: (path: string) => Promise<unknown>) {
  const fill = (argv: string[], v: Record<string, string>) => argv.map(a => a.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? ''))
  const changed = await run(fill(UNDO_COMMANDS.changed, { before, after }), {})
  if (changed.exitCode !== 0) return { done: false, restore: [], remove: [], refuse: [], error: 'its snapshots could not be read' }
  const plan = undoPlan(changed.stdout, '')
  const files = [...plan.restore, ...plan.remove]
  if (!files.length) return { done: true, ...plan, error: '' }
  const now = await snapshot(undoneRef, run)
  if (!now.commit) return { done: false, ...plan, error: now.error }
  const since = await run(fill(UNDO_COMMANDS.since, { after, now: now.commit }), {})
  const mine = new Set(files)
  const refuse = since.stdout.split('\0').filter(p => p && mine.has(p))
  if (refuse.length) return { done: false, restore: [], remove: [], refuse, error: '' }
  for (const p of plan.remove) await remove(p).catch(() => null)
  // The folders a created file leaves empty, deepest first; one that still holds anything stays
  const dirs = [...new Set(plan.remove.flatMap(p => p.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/'))))].sort((a, b) => b.length - a.length)
  for (const d of dirs) await rmdir(d).catch(() => null)
  if (plan.restore.length) {
    const r = await run(fill(UNDO_COMMANDS.restore, { before }), LITERAL, plan.restore.join('\0'))
    if (r.exitCode !== 0) return { done: false, ...plan, refuse: [], error: `git restore failed: ${(r.stderr || r.stdout).trim().split('\n')[0] ?? ''}` }
  }
  return { done: true, ...plan, refuse: [], error: '' }
}
