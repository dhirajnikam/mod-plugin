// Agents in worktrees of their own: a worktree Cockpit makes before the agent starts, its files compared with the
// commit it started from, brought back into your working tree, or removed. Cockpit's experts never commit, so an
// agent's work is the worktree's files, snapshotted with the turn plan (git/turns.ts) run inside it.

import { slashed } from '../core/text'

// The commands, as data: Cockpit runs them through $.process.run, and scripts/check_worktrees.py reads this same object
// out of this file and runs it on a real repository. Keep it valid JSON between the markers. apply and check read the
// patch on standard input, and touch files only, never the index
// wt:start
export const WORKTREE_COMMANDS = {
  "head": ["git", "rev-parse", "--verify", "-q", "HEAD"],
  "common": ["git", "rev-parse", "--git-common-dir"],
  "add": ["git", "worktree", "add", "-q", "-b", "{branch}", "{path}", "{base}"],
  "stat": ["git", "diff", "--numstat", "--no-renames", "-z", "{base}", "{snap}"],
  "diff": ["git", "diff", "--binary", "--no-renames", "{base}", "{snap}"],
  "check": ["git", "apply", "--check", "--whitespace=nowarn", "-"],
  "apply": ["git", "apply", "--whitespace=nowarn", "-"],
  "remove": ["git", "worktree", "remove", "--force", "{path}"],
  "dropBranch": ["git", "branch", "-d", "{branch}"],
  "prune": ["git", "worktree", "prune"],
  "list": ["git", "worktree", "list", "--porcelain"]
}
// wt:end

export { fillArgs } from '../git/turns'

// git's messages in English whatever your locale: applyRefusal reads them. Read by scripts/check_worktrees.py too: keep
// it valid JSON between the markers
// locale:start
export const C_LOCALE = { "LC_ALL": "C", "LANGUAGE": "C" }
// locale:end

// The ref a worktree's snapshot is kept under, named by the worktree's folder
export const worktreeRef = (path: string) => `refs/cockpit/worktrees/${path.split('/').pop()}`

// Where an agent's worktree goes and the branch it is on: in cockpit-worktrees under the repository's common git folder
// (`git rev-parse --git-common-dir`: the main repository's, even from a linked worktree, so removing that one never takes
// the agents' with it), so `git status` and the turn snapshots never see it. The id is the time it was made, never reused
export function worktreeFor(id: string, common: string) {
  const slug = id.replace(/[^\w-]/g, '_')
  const path = `${slashed(common)}/cockpit-worktrees/${slug}`
  return { path, branch: `cockpit/${slug}`, ref: worktreeRef(path) }
}

// What a worktree changed, from `git diff --numstat --no-renames -z`: "add\tdel\tpath\0" a file ("-\t-" a binary one)
export function parseStat(out: string): { files: string[]; add: number; del: number } {
  const files: string[] = []
  let add = 0
  let del = 0
  for (const row of out.split('\0')) {
    const m = row.match(/^(\d+|-)\t(\d+|-)\t([\s\S]+)$/)
    if (!m) continue
    files.push(m[3]!)
    add += Number(m[1]) || 0
    del += Number(m[2]) || 0
  }
  return { files, add, del }
}

// The files `git apply --check` (run with C_LOCALE, so in English) says will not apply: its patch failed there, it
// exists already, it is not there, a binary patch does not fit. A failed check refuses whether or not a file is named;
// any other error line is kept whole, so the refusal always says something
export function applyRefusal(stderr: string): string[] {
  const out = new Set<string>()
  const unq = (p: string) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : p)
  for (const line of stderr.split('\n')) {
    const m = line.match(/^error: (?:patch failed: (.+):\d+|(.+): (?:already exists in working directory|No such file or directory|patch does not apply|does not match index)|(?:cannot apply binary patch to|binary patch does not apply to) '(.+)'.*)$/)
    if (m) out.add(unq((m[1] ?? m[2] ?? m[3])!))
    else if (/^error: /.test(line)) out.add(line.slice(7))
  }
  return [...out]
}

// The worktree Claude Code made for an isolated agent: only one where Claude Code keeps its own (.claude/worktrees/),
// that was not there before the agent started and that no other agent holds. Any other new worktree (another
// session's, one Cockpit made under cockpit-worktrees) is never taken; none when there is no such
export function pickIsolated(list: { path: string; branch: string; head?: string }[], before: string[], claimed: string[]) {
  const was = new Set(before.map(slashed))
  const held = new Set(claimed.map(slashed))
  return list.find(w => /\/\.claude\/worktrees\//.test(slashed(w.path)) && !was.has(slashed(w.path)) && !held.has(slashed(w.path))) ?? null
}
