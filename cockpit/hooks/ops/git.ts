import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Account, Agent, Autopilot, Changed, RuleFiles, Commit, Decision, Flow, GitForm, Pending, Ph, ThemeId, PlanItem } from '../../types'
import { parseSettings, settingsText } from '../rules'
import { factsOf, featurePrompt, filesSig, importers, isCode, memoryKey, memoryMarkdown, parseFeatures, parseImports, resolveImport } from '../memory'
import { AGENT_TYPES, EXPERTS, PIPELINES, TYPES, recallOf, similarRuns, parseCommit, parsePr, baseFor, parseSteps, base, branchName, commitMsg, expertName, inferType, nJ, parseCases, parseReport, tally, verifyState } from '../logic'
import { INITIAL, PANE } from '../state'
import { snapshot, turnRef, undoTurn } from '../turns'
import type { Run } from '../turns'
import { THEME_IDS } from '../theme'
import type { $ } from './core'
import { claim, git, moveSaved, note, release, repoRoot, set, toast } from './core'

// The session's state, declared here as in every module that reads it: the engine reads a state atom from its literal
// plugin and key in the module that names it, so each reader declares the same atom
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-23' })

const firstLine = (r: { stdout: string; stderr: string }) => (r.stderr || r.stdout).trim().split('\n')[0] ?? ''

// The ticked files and their figures: a written commit stands while they stay the same
const commitSig = (s: Ph) => s.repo.changed.filter(f => s.staged[f.path] !== false).map(f => `${f.path} ${f.meta}`).join('\n')
const suggested = (s: Ph) => (s.suggest && !s.suggest.busy && s.suggest.sig === commitSig(s) ? s.suggest : null)

// The subject a commit gets: the typed one, else the one written from the diff, else the files it touches
export const subjectFor = (s: Ph, files: string[]) => s.git.subject.trim() || suggested(s)?.subject || (files.length ? `update ${[...new Set(files.map(base))].slice(0, 3).join(', ')}` : '')

// The commit's type and subject, written by a quick model from the diff of the ticked files (never from the prompt);
// one write per set of files, shared by everyone waiting on it
const writing = new Map<string, Promise<void>>()
export async function suggestCommit($: $) {
  const s = await read($, S)
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
// The project's paths: git's view (tracked and untracked, ignored left out), or a shallow walk outside a repository
export async function loadProject($: $) {
  // From the session's folder, as the Activity tree shows paths
  const r = await $.process.run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard']).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
  let project = r.exitCode === 0 ? r.stdout.split('\0').filter(Boolean) : []
  if (r.exitCode !== 0) {
    // ponytail: depth 3 and 3000 paths; git gives the full view where it exists
    const walk = async (dir: string, depth: number): Promise<string[]> => {
      if (depth > 3 || project.length > 3000) return []
      const entries = await $.fs.list(dir || undefined).catch(() => [])
      const out: string[] = []
      for (const en of entries) {
        if (en.name.startsWith('.') || en.name === 'node_modules') continue
        const p = dir ? `${dir}/${en.name}` : en.name
        if (en.kind === 'dir') out.push(...(await walk(p, depth + 1)))
        else if (en.kind === 'file') out.push(p)
      }
      return out
    }
    project = await walk('', 0)
  }
  await set($, { project: project.slice(0, 3000) })
}

export async function refreshRepo($: $) {
  await loadProject($)
  // -z: paths come unquoted whatever they hold; a rename is "R  new\0old\0"
  const st = await git($, ['status', '--porcelain=v1', '-z', '-b'])
  if (st.exitCode !== 0) return set($, { repo: { isRepo: false, current: '', ahead: 0, behind: 0, changed: [], branches: [], log: [], unpushed: [] } })
  const [head = '', ...rest] = st.stdout.split('\0')
  const current = head.replace(/^## (No commits yet on )?/, '').split('...')[0]?.replace(/^HEAD \(no branch\)$/, '') ?? ''
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
  const base = origin || ['main', 'master', 'develop'].find(b => branches.includes(b)) || ''
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
}

// A commit opened in the graph: its author, date, whole message and the files it changed
export async function showCommit($: $, sha: string) {
  const open = (await read($, S)).ui.openCommit === sha
  await set($, s => ({ ui: { ...s.ui, openCommit: open ? '' : sha, commitInfo: '' } }))
  if (open) return
  const r = await git($, ['show', '--stat=72', '--format=%an <%ae>%n%ad%n%n%B', '--date=format:%d %b %Y %H:%M', sha])
  await set($, s => (s.ui.openCommit === sha ? { ui: { ...s.ui, commitInfo: r.exitCode === 0 ? r.stdout.trim() : `git show failed: ${firstLine(r)}` } } : {}))
}

// Brings the current branch up to its upstream, fast-forward only: a pull that would merge says so and changes nothing
export async function pullNow($: $) {
  const r = await git($, ['pull', '--ff-only'])
  await toast($, r.exitCode === 0 ? `Pulled ${(await read($, S)).repo.current}` : `Pull failed: ${firstLine(r)}`)
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
  const s = await read($, S)
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
      const pr = await $.process
        .run(['gh', 'pr', 'create', '--base', base, '--head', br, '--title', msg, '--body', g.body || msg, ...(g.draft ? ['--draft'] : [])], { cwd: (await repoRoot($)) || '.' })
        .catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
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
  if (g.push) await loadPr($)
}

// Ask mode: propose the commit and wait for Commit or Skip in the band or the pane
export async function proposeCommit($: $) {
  const s = await read($, S)
  const p = { ...planCommit(s), at: await $.clock.now() }
  if (!p.files.length || !p.msg) return
  await set($, { pending: p })
  await toast($, `Commit proposed: ${p.msg}`)
}

export async function confirmPending($: $) {
  const p = (await read($, S)).pending
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
    const s = await read($, S)
    if (s.git.commitMode === 'auto') await commit($, true)
    else if (s.git.commitMode === 'ask') await proposeCommit($)
  } finally {
    await release($, 'commit')
  }
}

// Push the current branch
export async function pushNow($: $) {
  const s = await read($, S)
  const acct = s.accounts.find(a => a.id === s.accountId)
  const why = acct?.gh ? await ghUse($, acct.gh) : ''
  const p = await git($, ['push', '-u', 'origin', s.repo.current])
  await toast($, `${p.exitCode === 0 ? `Pushed ${s.repo.current}` : `Push failed: ${firstLine(p)}`}${why ? ` (${why})` : ''}`)
  await refreshRepo($)
  // A push starts the PR's checks again
  if (p.exitCode === 0) await loadPr($)
}

async function gh($: $, args: string[], stdin?: string, cwd?: string) {
  return $.process.run(['gh', ...args], { env: { GH_PROMPT_DISABLED: '1' }, ...(stdin ? { stdin } : {}), ...(cwd ? { cwd } : {}) }).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
}

// Push as a gh login: make it gh's active account, and have git ask gh for github.com's credentials, or git's own
// helper (Windows' manager) answers and the push goes out as whoever that remembers. '' when both worked, else why not
// ponytail: gh auth switch changes the machine's active GitHub account, not just this push; per-push tokens if that bites
// Each runs whatever the other did: a switch gh refuses must not leave git asking its own helper
async function ghUse($: $, login: string) {
  const sw = await gh($, ['auth', 'switch', '-h', 'github.com', '--user', login])
  const sg = await gh($, ['auth', 'setup-git', '-h', 'github.com'])
  return [sw.exitCode !== 0 && `gh switch to ${login} failed: ${firstLine(sw)}`, sg.exitCode !== 0 && `gh setup-git failed: ${firstLine(sg)}`].filter(Boolean).join(' · ')
}

// A gh login just added: git set to use it, the accounts read again, and the new login (gh's active one) chosen
async function ghAdded($: $) {
  await gh($, ['auth', 'setup-git', '-h', 'github.com'])
  const login = (await gh($, ['api', 'user', '--jq', '.login'])).stdout.trim()
  await loadAccounts($)
  const s = await read($, S)
  const a = s.accounts.find(x => x.gh === login && x.id.startsWith('gh-')) ?? s.accounts.find(x => x.gh === login)
  if (a) await useAccount($, a.id)
  await set($, st => ({ ui: { ...st.ui, acctOpen: false } }))
  return login
}

// gh login with a personal access token (classic, scopes repo and read:org) on stdin; gh keeps it, Cockpit never does
export async function ghLoginToken($: $, token: string) {
  const tk = token.trim()
  await set($, st => ({ ui: { ...st.ui, ghToken: '' } }))
  if (!tk) return toast($, 'Paste a GitHub token first')
  const r = await gh($, ['auth', 'login', '--with-token', '-h', 'github.com', '-p', 'https'], `${tk}\n`)
  if (r.exitCode !== 0) return toast($, `gh login failed: ${firstLine(r)}`)
  const login = await ghAdded($)
  await toast($, `Logged in to GitHub as ${login || 'the token’s account'}`)
}

// gh login in the browser: gh copies a one-time code to the clipboard and waits on github.com/login/device; what it
// writes is streamed into the note, so the code shows even where the clipboard is not reachable
export async function ghLoginWeb($: $) {
  await set($, st => ({ ui: { ...st.ui, ghNote: 'Starting gh…' } }))
  void (async () => {
    let said = ''
    let ok = false
    const run = $.process.spawn({ argv: ['gh', 'auth', 'login', '--web', '--clipboard', '-h', 'github.com', '-p', 'https', '--skip-ssh-key'], env: { GH_PROMPT_DISABLED: '1' } })
    // Pulled by hand, not for-await: the stream's return value (how gh ended) is what a for-await drops
    for (let r = await run.next(); ; r = await run.next()) {
      if (r.done) {
        ok = r.value.code === 0
        break
      }
      said += r.value.text
      const code = said.match(/code[^A-Z0-9]*\(?([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1]
      const note = code ? `Open github.com/login/device and enter the code ${code} (also on your clipboard), then approve. Waiting for GitHub…` : said.trim().split('\n').pop() ?? ''
      await set($, st => ({ ui: { ...st.ui, ghNote: note } }))
    }
    const login = ok ? await ghAdded($) : ''
    await set($, st => ({ ui: { ...st.ui, ghNote: ok ? `Logged in as ${login}.` : `gh login ended: ${said.trim().split('\n').pop() ?? 'no output'}` } }))
  })().catch(async e => set($, st => ({ ui: { ...st.ui, ghNote: `gh could not start: ${String(e)}` } })))
}

// Accounts: the ones saved across sessions, plus the global git identity and each gh login found on this machine
export async function loadAccounts($: $) {
  const saved = ((await $.store.get('accounts')) as Account[] | undefined) ?? []
  await moveSaved($, 'account')
  const chosen = ((await $.store.get(`account:${await repoRoot($)}`)) as string | undefined) ?? ((await $.store.get('accountId')) as string | undefined) ?? ''
  const name = (await git($, ['config', '--global', 'user.name'])).stdout.trim()
  const email = (await git($, ['config', '--global', 'user.email'])).stdout.trim()
  const st = await gh($, ['auth', 'status', '-h', 'github.com'])
  const out = `${st.stdout}${st.stderr}`
  // One block per login: "Logged in to github.com account <login> ..." then its "- Active account: true|false"; a
  // login whose token gh can no longer use reads "Failed to log in to github.com account <login>" instead
  const parts = out.split(/(Logged in to |Failed to log in to )/)
  const blocks = parts.slice(1).flatMap((p, i, a) => (i % 2 === 0 ? [{ ok: p.startsWith('Logged'), text: a[i + 1] ?? '' }] : []))
  const loginOf = (b: { text: string }) => b.text.match(/account (\S+)/)?.[1] ?? ''
  const logins = blocks.filter(b => b.ok).map(loginOf).filter(Boolean)
  const stale = blocks.filter(b => !b.ok).map(loginOf).filter(Boolean)
  const act = blocks.find(b => b.ok && /Active account: true/.test(b.text))
  const active = act ? loginOf(act) : (logins[0] ?? '')
  // The global identity pushes as the login of its own name when there is one, else as gh's active login
  const mine = logins.find(l => l.toLowerCase() === name.toLowerCase()) ?? active
  const found: Account[] = []
  if (name || email) found.push({ id: 'global', label: mine || name || 'global', name, email, gh: mine })
  // Every other login commits as its GitHub name and its no-reply address, which GitHub links to the account
  const rest = logins.filter(l => l !== mine || !(name || email))
  const users = await Promise.all(rest.map(l => gh($, ['api', `users/${l}`, '--jq', '[.id, .name // ""] | @tsv'])))
  rest.forEach((l, i) => {
    const [uid = '', real = ''] = (users[i]?.exitCode === 0 ? users[i].stdout.trim() : '').split('\t')
    found.push({ id: `gh-${l}`, label: l, name: real || l, email: uid ? `${uid}+${l}@users.noreply.github.com` : `${l}@users.noreply.github.com`, gh: l })
  })
  const accounts = [...saved, ...found.filter(f => !saved.some(a => a.id === f.id))]
  // A login whose token stopped working is named in the box, so it is not just missing; the note clears once it is fixed
  const staleNote = stale.length ? `The GitHub token for ${stale.join(', ')} no longer works: add a new token, or log in with gh again.` : ''
  await set($, st => ({
    accounts,
    accountId: accounts.some(a => a.id === chosen) ? chosen : (accounts[0]?.id ?? ''),
    ui: st.ui.ghNote === '' || st.ui.ghNote.startsWith('The GitHub token for ') ? { ...st.ui, ghNote: staleNote } : st.ui,
  }))
}

// The Git tab read again: the repository, and the accounts, so a login added or removed outside Cockpit (gh auth login
// in a terminal, an expired token) shows without a press of Detect. Not every turn: gh auth status checks each token
export async function refreshGit($: $) {
  await Promise.all([refreshRepo($).then(() => loadPr($)), loadAccounts($).catch(() => null)])
}

// Fix failing checks: Claude is handed each failing check's name and the end of its failed steps' log (GitHub Actions
// only; another CI's check goes with its link), and asked to find the cause and fix it
export async function fixChecks($: $) {
  const pr = (await read($, S)).repo.pr
  if (!pr?.checks.failing.length) return toast($, 'No failing checks to fix')
  const parts: string[] = []
  // ponytail: three checks, the last 120 lines and 6k characters of each log; enough to name the error, not to read it all
  for (const f of pr.checks.failing.slice(0, 3)) {
    const run = f.link.match(/\/actions\/runs\/(\d+)/)?.[1]
    const log = run ? await gh($, ['run', 'view', run, '--log-failed'], undefined, (await repoRoot($)) || undefined) : null
    const tail = log?.exitCode === 0 ? log.stdout.trim().split('\n').slice(-120).join('\n').slice(-6000) : ''
    parts.push(tail ? `${f.name}, the end of its failed steps:\n\`\`\`\n${tail}\n\`\`\`` : `${f.name}${f.link ? ` (${f.link})` : ''}: no log could be read`)
  }
  // privacy: none; the log goes into your own conversation, as a prompt you could have pasted (docs/privacy.md)
  const text = `Fix the failing CI checks on pull request #${pr.number} (${pr.title}). Find the cause from the log, fix it, and run the same check locally.\n\n${parts.join('\n\n')}`
  const r = await $.prompt.submit({ text }).catch(() => ({ drop: true }))
  if ('drop' in r && r.drop) await toast($, 'Could not hand the failing checks to Claude')
}

// The current branch's pull request and its checks, from gh. Not on the base branch (its PRs are other branches'), and
// no checks asked for when gh has no PR or cannot answer (not installed, not logged in, not a GitHub repository)
// Each read numbered: an older one that answers after a newer one is dropped
let prReads = 0
export async function loadPr($: $) {
  const n = ++prReads
  const s = await read($, S)
  const br = s.repo.current
  if (!s.repo.isRepo || !br || br === s.git.base) return
  const cwd = (await repoRoot($)) || undefined
  // -- before the branch: a ref named like a flag stays a branch name
  const view = await gh($, ['pr', 'view', '--json', 'number,title,url,state,isDraft,reviewDecision', '--', br], undefined, cwd)
  // gh cannot answer (offline, not logged in, rate limited): the row stays as it was; only "no pull requests" clears it
  if (view.exitCode !== 0 && !/no pull requests? found/i.test(view.stderr)) return
  // gh pr checks exits 8 while checks are pending and 1 when one failed, printing the JSON all the same
  // A PR with no CI: gh says "no checks reported" with nothing on stdout. Output cut off is unreadable, not "none"
  const checks = view.exitCode === 0 ? await gh($, ['pr', 'checks', '--json', 'name,bucket,link', '--', br], undefined, cwd) : null
  const listed = !checks || ('isStdoutTruncated' in checks && checks.isStdoutTruncated) ? '' : /no checks reported/i.test(checks.stderr) && !checks.stdout.trim() ? '[]' : checks.stdout
  const pr = view.exitCode === 0 ? parsePr(view.stdout, listed) : null
  if (n !== prReads) return
  await set($, st => (st.repo.current === br ? { repo: { ...st.repo, pr } } : {}))
}

export async function saveAccount($: $, a: Account) {
  if (!a.name.trim() || !a.email.trim()) return toast($, 'An account needs a name and an email')
  const acct = { ...a, id: a.id || `acct-${Date.now()}`, label: a.label.trim() || a.gh.trim() || a.name.trim() }
  const s = await read($, S)
  const accounts = [...s.accounts.filter(x => x.id !== acct.id), acct]
  await $.store.set('accounts', accounts.filter(x => x.id !== 'global' && !x.id.startsWith('gh-') || x.id === acct.id))
  await set($, st => ({ accounts, accountId: acct.id, ui: { ...st.ui, acctOpen: false, acct: { id: '', label: '', name: '', email: '', gh: '' } } }))
  await $.store.set('accountId', acct.id)
  await $.store.set(`account:${await repoRoot($)}`, acct.id)
  await toast($, `Saved account ${acct.label}`)
}

// Remove an account from the machine, not only from the list (the next Detect would find it again): its gh login is
// logged out, and for the global identity git's global user.name and user.email are unset too
export async function removeAccount($: $, id: string) {
  await set($, st => ({ ui: { ...st.ui, acctRemove: '' } }))
  const a = (await read($, S)).accounts.find(x => x.id === id)
  if (!a) return
  const why: string[] = []
  if (a.gh) {
    const r = await gh($, ['auth', 'logout', '-h', 'github.com', '-u', a.gh])
    if (r.exitCode !== 0 && !/not logged in/i.test(firstLine(r))) why.push(`gh logout failed: ${firstLine(r)}`)
  }
  // Exit 5: the key was not set, which is what removing it wants
  if (id === 'global')
    for (const k of ['user.name', 'user.email']) {
      const r = await git($, ['config', '--global', '--unset', k])
      if (r.exitCode !== 0 && r.exitCode !== 5) why.push(`git config --unset ${k} failed: ${firstLine(r)}`)
    }
  const saved = ((await $.store.get('accounts')) as Account[] | undefined) ?? []
  await $.store.set('accounts', saved.filter(x => x.id !== id))
  await loadAccounts($)
  await toast($, why.length ? why.join(' · ') : `Removed ${a.label} from this machine`)
}

export async function useAccount($: $, id: string) {
  await set($, { accountId: id })
  await $.store.set('accountId', id)
  await $.store.set(`account:${await repoRoot($)}`, id)
}

// Write the chosen identity into this repository's own git config
export async function applyAccount($: $) {
  const s = await read($, S)
  const a = s.accounts.find(x => x.id === s.accountId)
  if (!a) return toast($, 'Pick an account first')
  const n = await git($, ['config', 'user.name', a.name])
  const m = n.exitCode === 0 ? await git($, ['config', 'user.email', a.email]) : n
  if (m.exitCode !== 0) return toast($, `Could not set the identity: ${firstLine(m)}`)
  await toast($, `This repo now commits as ${a.name} <${a.email}>`)
}

// Turn snapshots (see turns.ts): the working tree before and after each turn, as Cockpit's own refs, so a turn can be
// undone whatever made its changes. A turn carried on in the same flow keeps its first before; a failure is quiet,
// since no turn may wait on or fail for it
const TURNS_KEPT = 50
async function turnRun($: $): Promise<Run> {
  const cwd = (await repoRoot($)) || '.'
  // ponytail: 30 s a command; a git that hangs (a lock, a huge add) fails the snapshot instead of holding every turn
  return (argv, env, stdin) => $.process.run(argv, { cwd, env, timeoutMs: 30_000, ...(stdin !== undefined ? { stdin } : {}) })
}
// One snapshot at a time: they share the one temporary index
let snapping: Promise<unknown> = Promise.resolve()
export async function snapTurn($: $, flowId: string | undefined, which: 'before' | 'after') {
  const mine = snapping.then(() => snapTurnNow($, flowId, which))
  snapping = mine.catch(() => null)
  return mine
}
async function snapTurnNow($: $, flowId: string | undefined, which: 'before' | 'after') {
  // Outside a repository the plan's first git command fails, and no snapshot is made
  if (!flowId) return
  const run = await turnRun($)
  const ref = turnRef(flowId, which)
  if (which === 'before' && (await run(['git', 'rev-parse', '--verify', '-q', ref], {})).exitCode === 0) return
  const r = await snapshot(ref, run)
  if (!r.commit) return
  await set($, st => ({ flows: st.flows.map(f => (f.id === flowId ? { ...f, snap: { ...f.snap, [which]: true } } : f)) }))
  if (which === 'after') await pruneTurns(run)
}
// Only the newest turns' refs are kept; older ones go (Cockpit's own refs under refs/cockpit/turns, never a branch)
export async function pruneTurns(run: Run, keep = TURNS_KEPT) {
  const list = await run(['git', 'for-each-ref', '--format=%(refname)', 'refs/cockpit/turns/'], {})
  if (list.exitCode !== 0) return
  const refs = list.stdout.split('\n').filter(r => r.startsWith('refs/cockpit/turns/'))
  // Newest first by the flow's id (f and the time it opened), whatever ref was written last
  const num = (f: string) => Number(f.replace(/\D/g, '')) || 0
  const flows = [...new Set(refs.map(r => r.split('/')[3]!))].sort((a, b) => num(b) - num(a))
  const old = new Set(flows.slice(keep))
  for (const r of refs) if (old.has(r.split('/')[3]!)) await run(['git', 'update-ref', '-d', r], {})
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
