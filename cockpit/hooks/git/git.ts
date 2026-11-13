import type { Changed, Pending, Ph, GitForm } from '../../types'
import { loadPr } from './pr'
import { loadAccounts, ghUse, gh } from './accounts'
import { base, firstLine } from '../core/text'
import type { $ } from '../core/core'
import { look, set, toast, note, claim, release } from '../core/core'
import { repoRoot, git, repoInfo, prefsKey, moveSaved, branchOf } from '../core/repos'
import { TYPES, BASE_BRANCHES, parseCommit, baseFor, inferType, branchName, commitMsg } from './git-form'
import { verifyState } from '../agents/experts'
import { INITIAL } from '../core/state'

// The ticked files and their figures: a written commit stands while they stay the same
const commitSig = (s: Ph) => s.repo.changed.filter(f => s.staged[f.path] !== false).map(f => `${f.path} ${f.meta}`).join('\n')
const suggested = (s: Ph) => (s.suggest && !s.suggest.busy && s.suggest.sig === commitSig(s) ? s.suggest : null)

// The subject a commit gets: the typed one, else the one written from the diff, else the files it touches
const subjectFor = (s: Ph, files: string[]) => s.git.subject.trim() || suggested(s)?.subject || (files.length ? `update ${[...new Set(files.map(base))].slice(0, 3).join(', ')}` : '')

// The commit's type and subject, written by a quick model from the diff of the ticked files (never from the prompt);
// one write per set of files, shared by everyone waiting on it
const writing = new Map<string, Promise<void>>()
export async function suggestCommit($: $) {
  const s = await look($)
  const sig = commitSig(s)
  if (!sig || (s.suggest?.sig === sig && !s.suggest.busy)) return
  const w = writing.get(sig) ?? writeCommit($, s, sig).finally(() => writing.delete(sig))
  writing.set(sig, w)
  return w
}

async function writeCommit($: $, s: Ph, sig: string) {
  await set($, { suggest: { sig, type: '', subject: '', busy: true } })
  const picked = s.repo.changed.filter(f => s.staged[f.path] !== false)
  const root = await repoRoot($)
  const tracked = picked.filter(f => f.meta !== 'new').flatMap(f => (f.from ? [f.path, f.from] : [f.path]))
  const diff = tracked.length ? (await git($, ['diff', 'HEAD', '-M', '--', ...tracked])).stdout : ''
  // ponytail: a new file shows its first 60 lines, ten files at most; the whole prompt is cut at 15k characters
  const fresh = await Promise.all(
    picked
      .filter(f => f.meta === 'new')
      .slice(0, 10)
      .map(async f => `new file ${f.path}\n${(await $.fs.read(`${root}/${f.path}`).catch(() => '')).split('\n').slice(0, 60).join('\n')}`),
  )
  // privacy: commit-message (docs/privacy.md lists what it sends)
  const r = await $.model
    .complete({
      model: 'haiku',
      maxTokens: 200,
      system: 'You write git commit messages. Answer with JSON only.',
      prompt: `Write the commit for this change from what the diff does. type is one of ${TYPES.join(', ')}. subject says what changed, imperative, lower case, under 60 characters, no period and no type prefix (for example "add rate limiting to the login route"). Answer with JSON only: {"type": "...", "subject": "..."}.\n\nFiles:\n${picked.map(f => `${f.path} (${f.meta})`).join('\n')}\n\n${`${diff}\n${fresh.join('\n\n')}`.slice(0, 15000)}`,
    })
    .catch(() => null)
  const c = r && r.isAnswered ? parseCommit(r.text) : null
  await set($, st => (st.suggest?.sig === sig ? { suggest: { sig, type: c?.type ?? '', subject: c?.subject ?? '' } } : {}))
}

// Branch, ahead count, local branches and uncommitted files with their line counts
export async function refreshRepo($: $) {
  // -z: paths come unquoted whatever they hold; a rename is "R  new\0old\0"
  const st = await git($, ['status', '--porcelain=v1', '-z', '-b'])
  if (st.exitCode !== 0) return set($, { repo: INITIAL.repo })
  const [head = '', ...rest] = st.stdout.split('\0')
  const current = branchOf(head).replace(/^HEAD \(no branch\)$/, '')
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0)
  const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0)
  // numstat -z: "a\td\tpath\0", a rename "a\td\t\0old\0new\0"
  const counts = new Map<string, [number, number]>()
  const num = (await git($, ['diff', '--numstat', '-z', 'HEAD'])).stdout.split('\0')
  for (let i = 0; i < num.length; i++) {
    const [a, d, p] = (num[i] ?? '').split('\t')
    if (a === undefined || d === undefined) continue
    const path = p || num[(i += 2)] || ''
    if (path) counts.set(path, [Number(a) || 0, Number(d) || 0])
  }
  const changed: Changed[] = []
  for (let i = 0; i < rest.length; i++) {
    const l = rest[i] ?? ''
    if (l.length < 4) continue
    const code = l.slice(0, 2)
    const path = l.slice(3)
    const from = code.includes('R') || code.includes('C') ? rest[++i] : undefined
    const [add, del] = counts.get(path) ?? [0, 0]
    const meta = code === '??' ? 'new' : code.includes('D') ? 'deleted' : from ? `renamed · +${add} −${del}` : `+${add} −${del}`
    changed.push({ path, add, del, meta, ...(from ? { from } : {}) })
  }
  const branches = (await git($, ['branch', '--format=%(refname:short)'])).stdout.split('\n').map(b => b.trim()).filter(Boolean)
  const origin = (await git($, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).stdout.trim().replace(/^origin\//, '')
  // No origin HEAD and no usual base: none is guessed, so the branch you happen to be on is not kept as the base
  // (the PR would then never be read); a PR opened from here falls back to the current branch itself
  const base = origin || BASE_BRANCHES.find(b => branches.includes(b)) || ''
  // Every branch, remote and tag in graph order: hash, parents, refs, subject, age, author, one field each
  const log = (await git($, ['log', '--branches', '--remotes', '--tags', '--topo-order', '-n', '40', '--format=%h%x1f%p%x1f%D%x1f%s%x1f%ar%x1f%an'])).stdout
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [sha = '', parents = '', refs = '', msg = '', when = '', author = ''] = l.split('\x1f')
      return { sha, parents: parents.split(' ').filter(Boolean), refs: refs.split(', ').filter(r => r && !/\/HEAD$/.test(r)), msg, when, author }
    })
  // What the upstream lacks; no upstream, nothing is marked
  const up = await git($, ['log', '--format=%h', '@{u}..HEAD'])
  const unpushed = up.exitCode === 0 ? up.stdout.split('\n').filter(Boolean) : []
  // The branch's pull request is read only by loadPr (it asks GitHub); kept while the branch stays the same
  await set($, s => ({ repo: { isRepo: true, current, ahead, behind, changed, branches, log, unpushed, ...(s.repo.current === current && s.repo.pr !== undefined ? { pr: s.repo.pr } : {}) }, git: { ...s.git, base: baseFor(s.git.base, current, base) } }))
  // The next commit's message is written in the background; Commit waits for it
  void suggestCommit($).catch(() => null)
  await repoInfo($)
}

// A commit opened in the graph: its author, date, whole message and the files it changed
export async function showCommit($: $, sha: string) {
  const open = (await look($)).ui.openCommit === sha
  await set($, s => ({ ui: { ...s.ui, openCommit: open ? '' : sha, commitInfo: '' } }))
  if (open) return
  const r = await git($, ['show', '--stat=72', '--format=%an <%ae>%n%ad%n%n%B', '--date=format:%d %b %Y %H:%M', sha])
  await set($, s => (s.ui.openCommit === sha ? { ui: { ...s.ui, commitInfo: r.exitCode === 0 ? r.stdout.trim() : `git show failed: ${firstLine(r)}` } } : {}))
}

// Brings the current branch up to its upstream, fast-forward only: a pull that would merge says so and changes nothing
export async function pullNow($: $) {
  const r = await git($, ['pull', '--ff-only'])
  await toast($, r.exitCode === 0 ? `Pulled ${(await look($)).repo.current}` : `Pull failed: ${firstLine(r)}`)
  await refreshRepo($)
}

export async function gitInit($: $) {
  const r = await git($, ['init'])
  await toast($, r.exitCode === 0 ? 'Initialised a git repository' : `git init failed: ${r.stderr.trim()}`)
  await refreshRepo($)
}

// What the next commit would be: its type (from the diff unless you chose Manual), branch, message and files
export function planCommit(s: Ph): Pending {
  const files = s.repo.changed.filter(f => s.staged[f.path] !== false).map(f => f.path)
  const type = s.git.commitMode === 'manual' ? s.git.type : suggested(s)?.type || inferType('', files)
  const subject = subjectFor(s, files)
  const g = { ...s.git, type, subject }
  const branch = branchName(g, s.repo.current)
  return { type, branch, msg: subject ? commitMsg(g, branch) : '', files, at: 0 }
}

// Commit the staged files; push and open a PR when the form says so. `plan` commits as proposed (ask mode)
export async function commit($: $, auto: boolean, plan?: Pending) {
  if (!plan) await suggestCommit($)
  const s = await look($)
  const p = plan ?? planCommit(s)
  const g = { ...s.git, type: p.type }
  const picked = s.repo.changed.filter(f => p.files.includes(f.path))
  const files = picked.map(f => f.path)
  if (!files.length) return toast($, 'Nothing staged to commit')
  const subject = subjectFor(s, files)
  if (g.preTest && !verifyState(s.agents).passed) return toast($, 'Only after the Verify experts pass is on: they have not passed yet')
  const br = p.branch || s.repo.current
  if (br && br !== s.repo.current) {
    const sw = await git($, ['switch', br])
    if (sw.exitCode !== 0) {
      const mk = await git($, ['switch', '-c', br])
      if (mk.exitCode !== 0) return toast($, `Could not switch to ${br}: ${firstLine(/already exists/.test(mk.stderr) ? sw : mk)}`)
    }
  }
  const add = await git($, ['add', '-A', '--', ...files])
  if (add.exitCode !== 0) return toast($, `git add failed: ${firstLine(add)}`)
  const acct = s.accounts.find(a => a.id === s.accountId)
  const who = acct ? ['-c', `user.name=${acct.name}`, '-c', `user.email=${acct.email}`] : []
  const msg = p.msg || commitMsg({ ...g, subject }, br)
  // The pathspec commits the ticked files alone, not whatever else sits in the index; a rename needs its old path too
  const paths = [...files, ...picked.flatMap(f => (f.from ? [f.from] : []))]
  const args = [...who, 'commit', '-m', msg, ...(g.body ? ['-m', g.body] : []), ...(g.signoff ? ['-s'] : []), ...(g.gpg ? ['-S'] : []), '--', ...paths]
  const c = await git($, args)
  if (c.exitCode !== 0) return toast($, `Commit failed: ${firstLine(c)}`)
  const sha = (await git($, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
  const extra: string[] = []
  if (auto) extra.push('auto')
  if (g.push && acct?.gh) {
    const why = await ghUse($, acct.gh)
    if (why) extra.push(why)
  }
  if (g.push) {
    const p = await git($, ['push', '-u', 'origin', br])
    extra.push(p.exitCode === 0 ? 'pushed' : `push failed: ${firstLine(p)}`)
    // No base to open it against: gh would be asked for a PR from the branch into itself
    if (p.exitCode === 0 && g.pr && !g.base) extra.push('no PR: pick a base in Patterns & options')
    if (p.exitCode === 0 && g.pr && g.base) {
      const base = g.base
      const pr = await gh($, ['pr', 'create', '--base', base, '--head', br, '--title', msg, '--body', g.body || msg, ...(g.draft ? ['--draft'] : [])], undefined, (await repoRoot($)) || '.')
      extra.push(pr.exitCode === 0 ? `${g.draft ? 'draft PR' : 'PR'} → ${base} ${pr.stdout.trim()}` : `PR failed: ${firstLine(pr)}`)
    }
  }
  await set($, st => ({
    commits: [{ sha, auto, msg, meta: [br, `${files.length} files`, ...extra].join(' · ') }, ...st.commits].slice(0, 30),
    flows: st.flows.map((f, i) => (i === st.flows.length - 1 ? { ...f, commit: sha, reached: f.reached.includes('Commit') ? f.reached : [...f.reached, 'Commit'] } : f)),
    staged: {},
    pending: null,
    // The next commit starts from a fresh subject; the branch now is the checkout's
    git: { ...st.git, subject: '', body: '', branch: '' },
    reached: st.reached.includes('Commit') ? st.reached : [...st.reached, 'Commit'],
  }))
  await toast($, `${auto ? 'Auto-committed' : 'Committed'} ${sha}${extra.length ? ` · ${extra.join(' · ')}` : ''}`)
  await note($, `⎇ ${auto ? 'Auto-committed' : 'Committed'} ${sha} · ${msg}`)
  await refreshRepo($)
  // A push starts the checks of the branch's PR again, or opened one
  if (g.push) await loadPr($, { pushed: true })
}

// Ask mode: propose the commit and wait for Commit or Skip in the band or the pane
async function proposeCommit($: $) {
  const s = await look($)
  const p = { ...planCommit(s), at: await $.clock.now() }
  if (!p.files.length || !p.msg) return
  await set($, { pending: p })
  await toast($, `Commit proposed: ${p.msg}`)
}

export async function confirmPending($: $) {
  const p = (await look($)).pending
  if (p) await commit($, true, p)
}

export async function skipPending($: $) {
  await set($, { pending: null })
}

// What happens to this turn's changes, by the chosen commit mode
export async function decideCommit($: $) {
  // A commit you pressed is still running: this turn's changes wait for the next turn's end rather than race it on
  // the same files (and a press during this one is refused)
  if (!(await claim($, 'commit', 'Committing'))) return
  try {
    await suggestCommit($)
    const s = await look($)
    if (s.git.commitMode === 'auto') await commit($, true)
    else if (s.git.commitMode === 'ask') await proposeCommit($)
  } finally {
    await release($, 'commit')
  }
}

export async function pushNow($: $) {
  const s = await look($)
  const acct = s.accounts.find(a => a.id === s.accountId)
  const why = acct?.gh ? await ghUse($, acct.gh) : ''
  const p = await git($, ['push', '-u', 'origin', s.repo.current])
  await toast($, `${p.exitCode === 0 ? `Pushed ${s.repo.current}` : `Push failed: ${firstLine(p)}`}${why ? ` (${why})` : ''}`)
  await refreshRepo($)
  // A push starts the PR's checks again
  if (p.exitCode === 0) await loadPr($, { pushed: true })
}

// The Git tab read again: the repository, and the accounts, so a login added or removed outside Cockpit (gh auth login
// in a terminal, an expired token) shows without a press of Detect. Not every turn: gh auth status checks each token
export async function refreshGit($: $) {
  await Promise.all([refreshRepo($).then(() => loadPr($)), loadAccounts($).catch(() => null)])
}

// The Git tab's settings, kept per repository across sessions: what you chose stays until you change it
const GIT_PREFS: (keyof GitForm)[] = ['branchAuto', 'branchPattern', 'ticket', 'user', 'base', 'type', 'msgPattern', 'commitMode', 'autoWhen', 'setupDone', 'breaking', 'push', 'pr', 'draft', 'signoff', 'gpg', 'preTest']
export async function setGit($: $, patch: Partial<GitForm>) {
  await set($, s => ({ git: { ...s.git, ...patch } }))
  const g = (await look($)).git
  await $.store.set(await prefsKey($), Object.fromEntries(GIT_PREFS.map(k => [k, g[k]])))
}
export async function loadGitPrefs($: $) {
  await moveSaved($, 'git')
  const saved = (await $.store.get(await prefsKey($))) as Partial<GitForm> | undefined
  if (saved) await set($, s => ({ git: { ...s.git, ...saved } }))
}

// Work on another found repo: every git and gh call follows repoRoot, so the tab's state is read again from it
export async function pickRepo($: $, dir: string, hand = true) {
  const s = await look($)
  if (dir === s.repoDir || !s.repos.some(r => r.dir === dir)) return
  await set($, { repoDir: dir, ...(hand ? { repoHand: true } : {}), git: INITIAL.git, staged: {}, pending: null })
  await $.store.set(`repo:${await $.session.cwd().catch(() => '')}`, dir).catch(() => null)
  await loadGitPrefs($)
  await refreshGit($)
}

// Claude edited a file in another found repo: follow it, unless the person picked a repo by hand
export async function followEdit($: $, file: string) {
  await repoRoot($)
  const s = await look($)
  if (s.repoHand || s.repos.length < 2) return
  const to = s.repos.find(r => file.startsWith(`${r.dir}/`))
  if (to) await pickRepo($, to.dir, false)
}
