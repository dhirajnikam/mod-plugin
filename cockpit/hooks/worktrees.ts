// Agents in worktrees of their own: a worktree Cockpit makes before the agent starts, its files compared with the
// commit it started from, brought back into your working tree, or removed. Cockpit's experts never commit, so an
// agent's work is the worktree's files, snapshotted with the turn plan (turns.ts) run inside it.

// The commands, as data: Cockpit runs them through $.process.run, and scripts/check_worktrees.py reads this same object
// out of this file and runs it on a real repository. Keep it valid JSON between the markers. apply and check read the
// patch on standard input, and touch files only, never the index
// wt:start
export const WORKTREE_COMMANDS = {
  "head": ["git", "rev-parse", "--verify", "-q", "HEAD"],
  "home": ["git", "rev-parse", "--git-path", "cockpit-worktrees"],
  "add": ["git", "worktree", "add", "-q", "-b", "{branch}", "{path}", "{base}"],
  "stat": ["git", "diff", "--numstat", "--no-renames", "-z", "{base}", "{snap}"],
  "diff": ["git", "diff", "--binary", "--no-renames", "{base}", "{snap}"],
  "check": ["git", "apply", "--check", "--whitespace=nowarn", "-"],
  "apply": ["git", "apply", "--whitespace=nowarn", "-"],
  "remove": ["git", "worktree", "remove", "--force", "{path}"]
}
// wt:end

export const fillArgs = (argv: string[], v: Record<string, string>) => argv.map(a => a.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? ''))

// Where an agent's worktree goes and the branch it is on: under the repository's git folder (the path `git rev-parse
// --git-path cockpit-worktrees` gives), so `git status` and the turn snapshots never see it
export function worktreeFor(id: string, home: string) {
  const slug = id.replace(/[^\w-]/g, '_')
  return { path: `${home.replace(/\\/g, '/').replace(/\/+$/, '')}/${slug}`, branch: `cockpit/${slug}`, ref: `refs/cockpit/worktrees/${slug}` }
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

// The files `git apply --check` says will not apply (its patch failed there, it exists already, or it is not there)
export function applyRefusal(stderr: string): string[] {
  const out = new Set<string>()
  for (const line of stderr.split('\n')) {
    const m = line.match(/^error: (?:patch failed: (.+):\d+|(.+): (?:already exists in working directory|does not exist in index|No such file or directory|patch does not apply|does not match index))$/)
    if (m) out.add((m[1] ?? m[2])!)
  }
  return [...out]
}
