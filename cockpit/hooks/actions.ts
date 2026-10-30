import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Account, Agent, Changed, Commit, Decision, Flow, GitForm, Pending, Ph, ThemeId } from '../types'
import { factsOf, featurePrompt, filesSig, importers, isCode, memoryKey, memoryMarkdown, parseFeatures, parseImports, resolveImport } from './memory'
import { AGENT_TYPES, EXPERTS, PIPELINES, TYPES, parseCommit, parseSteps, base, branchName, commitMsg, expertName, inferType, nJ, parseCases, parseReport, tally, verifyState } from './logic'
import { INITIAL, PANE } from './state'
import { THEME_IDS } from './theme'

// The session's Cockpit state (see state.ts)
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-23' })

type $ = EngineInterface
type Patch = Partial<Ph> | ((s: Ph) => Partial<Ph>)

// The choices that outlast a session, a reload and a change of the state's shape: kept in the store, read at session start
const PREFS = ['focus', 'theme', 'mode', 'autoVerify', 'testAgents'] as const
export async function set($: $, patch: Patch) {
  let saved: Record<string, unknown> | null = null
  await update($, S, s => {
    const n = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) }
    if (PREFS.some(k => n[k] !== s[k])) saved = Object.fromEntries(PREFS.map(k => [k, n[k]]))
    return n
  })
  if (saved) await $.store.set('prefs', saved).catch(() => null)
}

// Cockpit's folder in the repository, kept out of git (and so out of every commit) by its own .gitignore
async function cockpitDir($: $) {
  const root = await repoRoot($)
  if (!root) return ''
  const dir = `${root}/.cockpit`
  if (!(await $.fs.exists(`${dir}/.gitignore`).catch(() => true))) await $.fs.write(`${dir}/.gitignore`, '# Cockpit keeps its history and codebase memory here, out of git\n*\n').catch(() => null)
  return dir
}

// What a run was, without its log and brief
const summary = (a: Agent): Agent => ({ ...a, log: [], prompt: '' })

// The repository's history: every finished flow and agent run, and Cockpit's commits, across sessions
export async function saveHistory($: $) {
  const dir = await cockpitDir($)
  if (!dir) return
  const s = await read($, S)
  const flows = [...s.past, ...s.flows.filter(f => f.status !== 'running')]
  const agents = [...s.pastAgents, ...s.agents.filter(a => a.status !== 'running').map(summary)]
  const dedupe = <T extends { id: string }>(xs: T[]) => [...new Map(xs.map(x => [x.id, x])).values()]
  const data = { version: 1, savedAt: await $.clock.now(), flows: dedupe(flows).slice(-200), agents: dedupe(agents).slice(-100), commits: s.commits.slice(0, 50) }
  await $.fs.write(`${dir}/history.json`, JSON.stringify(data, null, 1)).catch(() => null)
}

export async function loadHistory($: $) {
  const dir = await cockpitDir($)
  if (!dir) return
  const text = await $.fs.read(`${dir}/history.json`).catch(() => '')
  if (!text) return
  try {
    const d = JSON.parse(text) as { flows?: Flow[]; agents?: Agent[]; commits?: Commit[] }
    await set($, s => ({
      past: (d.flows ?? []).filter(f => !s.flows.some(x => x.id === f.id)),
      pastAgents: (d.agents ?? []).filter(a => !s.agents.some(x => x.id === a.id)),
      commits: [...s.commits, ...(d.commits ?? []).filter(c => !s.commits.some(x => x.sha === c.sha))].slice(0, 50),
    }))
  } catch {
    // A history file that does not parse is left as it is and read as empty
  }
}

// The steps of this prompt's task, written by a quick model in the background; the template stands until they come
export async function writeSteps($: $, flowId: string, task: string) {
  const r = await $.model
    .complete({
      model: 'haiku',
      maxTokens: 400,
      system: 'You plan coding work. Answer with JSON only.',
      prompt: `Break this task for a coding assistant into 3 to 6 steps, in the order they will happen, each under 7 words and specific to this task (name the files or features where you can). Tag each step with the kind of work that reaches it, one of: Understand, Explore, Decide, Implement, Verify, Commit, Answer. A question ends in Answer; a change to code ends in Verify, then Commit. Answer with JSON only: [{"step": "...", "kind": "..."}].\n\nTask: ${task.slice(0, 800)}`,
    })
    .catch(() => null)
  const steps = r && r.isAnswered ? parseSteps(r.text) : []
  if (steps.length >= 2) await set($, s => ({ flows: s.flows.map(f => (f.id === flowId ? { ...f, steps } : f)) }))
}

// The codebase memory, built from every source file's imports at session start (in the background) and kept in
// .cockpit/memory.json and .cockpit/MEMORY.md
// ponytail: 1500 files and 300 KB a file; a bigger repository is mapped in part, by git's order
export async function buildMemory($: $, rename = false) {
  const root = await repoRoot($)
  const r = await git($, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  if (!root || r.exitCode !== 0) return
  const all = r.stdout.split('\0').filter(Boolean)
  const has = new Set(all)
  const src = all.filter(isCode).slice(0, 1500)
  const files: Record<string, string[]> = {}
  const facts: Record<string, { exports: string[]; note: string }> = {}
  for (let i = 0; i < src.length; i += 24) {
    await Promise.all(
      src.slice(i, i + 24).map(async p => {
        const text = await $.fs.read(`${root}/${p}`).catch(() => '')
        files[p] = text.length > 300_000 ? [] : [...new Set(parseImports(p, text).map(x => resolveImport(p, x, f => has.has(f))).filter((x): x is string => !!x))]
        facts[p] = factsOf(p, text.slice(0, 20_000))
      }),
    )
  }
  // The features named last time stand while the same files are there; a new or removed file names them again
  const sig = filesSig(files)
  let saved: { sig?: string; features?: { name: string; what: string; files: string[] }[] } = {}
  try {
    saved = JSON.parse((await $.fs.read(`${root}/.cockpit/memory.json`).catch(() => '')) || '{}')
  } catch {
    // A memory file that does not parse is written again below
  }
  const kept = !rename && saved.sig === sig && saved.features?.length ? saved.features : undefined
  await set($, { memory: { at: await $.clock.now(), files, ...(kept ? { features: kept, sig } : {}) } })
  await saveMemory($)
  if (!kept && Object.keys(files).length) await nameFeatures($, files, facts, sig)
}

// A model names the product's features from each file's exports, first comment and imports, in the background
export async function nameFeatures($: $, files: Record<string, string[]>, facts: Record<string, { exports: string[]; note: string }>, sig: string) {
  await set($, s => ({ memory: { ...s.memory, naming: true } }))
  const r = await $.model.complete({ model: 'sonnet', maxTokens: 6000, system: 'You map codebases. Answer with JSON only.', prompt: featurePrompt(files, facts) }).catch(() => null)
  const named = r && r.isAnswered ? parseFeatures(r.text, files) : []
  await set($, s => ({ memory: { ...s.memory, naming: false, ...(named.length ? { features: named, sig } : {}) } }))
  if (named.length) await saveMemory($)
  else await toast($, 'The features could not be named: they are shown by folder')
}

// One file again after an edit: its imports now, the file's entry dropped when it is gone
export async function updateMemory($: $, path: string) {
  const s = await read($, S)
  const root = await repoRoot($)
  if (!root || !s.memory.at) return
  const abs = path.startsWith('/') || /^[A-Za-z]:/.test(path) ? path.replace(/\\/g, '/') : `${await $.session.cwd().catch(() => root)}/${path}`
  const rel = abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : memoryKey(s.memory.files, path)
  if (!rel || !isCode(rel)) return
  const text = await $.fs.read(`${root}/${rel}`).catch(() => null)
  const known = new Set(Object.keys(s.memory.files))
  const imports = text === null ? null : [...new Set(parseImports(rel, text).map(x => resolveImport(rel, x, f => known.has(f) || f === rel)).filter((x): x is string => !!x))]
  const at = await $.clock.now()
  await set($, st => {
    const files = { ...st.memory.files }
    if (imports === null) delete files[rel]
    else files[rel] = imports
    return { memory: { ...st.memory, at, files } }
  })
  await saveMemory($)
}

async function saveMemory($: $) {
  const dir = await cockpitDir($)
  if (!dir) return
  const m = (await read($, S)).memory
  const by = importers(m.files)
  await $.fs.write(`${dir}/memory.json`, JSON.stringify({ version: 2, builtAt: m.at, sig: m.sig ?? '', features: m.features ?? [], files: Object.fromEntries(Object.entries(m.files).map(([f, uses]) => [f, { uses, usedBy: by[f] ?? [] }])) }, null, 1)).catch(() => null)
  await $.fs.write(`${dir}/MEMORY.md`, memoryMarkdown(m.files, new Date(m.at).toISOString().slice(0, 16).replace('T', ' '), m.features)).catch(() => null)
}

export async function loadPrefs($: $) {
  const p = (await $.store.get('prefs').catch(() => undefined)) as Partial<Ph> | undefined
  if (!p || typeof p !== 'object') return
  const pick = Object.fromEntries(PREFS.filter(k => k in p && p[k] !== undefined && (k !== 'theme' || THEME_IDS.includes(p.theme as ThemeId))).map(k => [k, p[k]]))
  await update($, S, s => ({ ...s, ...pick }))
}

export async function toast($: $, text: string) {
  $.ui.toast(`◆ ${text}`)
}

// A line in the chat for work Cockpit ran itself (no tool row exists for it); the model never reads it
export async function note($: $, text: string) {
  await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } }).catch(() => null)
}

// The repository's top folder, per session folder: git names changed files from there, so a session working in a
// subfolder (cockpit/) must run git there too, or `git add cockpit/x` looks for cockpit/cockpit/x
const roots = new Map<string, string>()
export async function repoRoot($: $) {
  const cwd = await $.session.cwd().catch(() => '')
  const known = roots.get(cwd)
  if (known !== undefined) return known
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel']).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }))
  const top = r.exitCode === 0 && /^([A-Za-z]:)?[\\/]/.test(r.stdout.trim()) ? r.stdout.trim() : cwd
  roots.set(cwd, top)
  return top
}

async function git($: $, args: string[]) {
  const cwd = await repoRoot($)
  return $.process.run(['git', ...args], cwd ? { cwd } : {}).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
}

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
  const base = origin || ['main', 'master', 'develop'].find(b => branches.includes(b)) || current
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
  await set($, s => ({ repo: { isRepo: true, current, ahead, behind, changed, branches, log, unpushed }, git: { ...s.git, base: s.git.base || base } }))
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
    if (p.exitCode === 0 && g.pr) {
      const base = g.base || s.repo.current
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
  await suggestCommit($)
  const s = await read($, S)
  if (s.git.commitMode === 'auto') await commit($, true)
  else if (s.git.commitMode === 'ask') await proposeCommit($)
}

// Push the current branch
export async function pushNow($: $) {
  const s = await read($, S)
  const acct = s.accounts.find(a => a.id === s.accountId)
  const why = acct?.gh ? await ghUse($, acct.gh) : ''
  const p = await git($, ['push', '-u', 'origin', s.repo.current])
  await toast($, `${p.exitCode === 0 ? `Pushed ${s.repo.current}` : `Push failed: ${firstLine(p)}`}${why ? ` (${why})` : ''}`)
  await refreshRepo($)
}

async function gh($: $, args: string[], stdin?: string) {
  return $.process.run(['gh', ...args], { env: { GH_PROMPT_DISABLED: '1' }, ...(stdin ? { stdin } : {}) }).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
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

const PERSONAS = ['a pragmatic senior engineer', 'a security reviewer', 'a long-term maintainer', 'the end user', 'a sceptic who prefers the safest option', 'a performance engineer', 'a test engineer', 'a software architect', 'a minimalist who prefers less code']

async function recentContext($: $, s: Ph, q: string) {
  const r = await $.model.fork({ prompt: `In at most 120 words, state the task and the facts that matter for this decision: "${q}". No preamble.` }).catch(() => null)
  return r?.isAnswered ? r.text : s.task
}

// Score a question's complexity, seat 3/6/9 judges, and let them vote; returns the winning label or '' for a split
// Decisions that publish, push, delete, merge, send or are otherwise hard to undo: the judges only advise on these
export const RISKY = /\b(public|publish|push|pushed|delete|remove|merge|deploy|release|send|post|email|force|drop|reset|overwrite|revoke|pay|purchase|production|prod|permissions?|settings?|config|rules?|allow|credentials?|tokens?|secrets?|passwords?|keys?|auth|login)\b/i

// Questions only the person can answer, about what they saw, did or want: the judges never take these
export const PERSONAL = /^(did|does|do you|have you|has it|is it|are you|was it|were you)\b|\b(did|you see|you saw|in your (pane|terminal|screen|app|session|browser)|look right|work for you|for you now|your (preference|choice|call))\b/i

// Score a question's complexity, seat 3/6/9 judges and let them vote; returns the winning label, or '' on a split.
// act false: the judges only advise (their pick is kept as advice, the decision stays the person's)
export async function judge($: $, id: string, q: string, opts: { label: string; description?: string }[], act = true) {
  const s0 = await read($, S)
  const scoreR = await $.model
    .complete({
      model: 'haiku',
      maxTokens: 200,
      prompt: `Rate how complex and risky this decision is for a coding agent, 0 (trivial, reversible) to 10 (security, data loss, irreversible). Question: "${q}" Options: ${opts.map(o => o.label).join(' | ')}. Answer as JSON only: {"score": n, "signals": ["2-4 word reason", "...", "..."]}`,
    })
    .catch(() => null)
  let score = 5
  let signals: string[] = []
  try {
    const j = JSON.parse((scoreR?.isAnswered ? scoreR.text : '{}').replace(/^[^{]*/, '').replace(/[^}]*$/, ''))
    score = Math.max(0, Math.min(10, Math.round(Number(j.score) || 5)))
    signals = Array.isArray(j.signals) ? j.signals.slice(0, 3).map(String) : []
  } catch {}
  const n = nJ(score)
  await set($, s => ({
    activity: `Judging · ${n} judges`,
    decisions: s.decisions.map(d => (d.id === id ? { ...d, score, signals, votes: Array(n).fill(-1), status: d.status === 'you' ? 'you' : 'voting' } : d)),
  }))
  const brief = await recentContext($, s0, q)
  const menu = opts.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n')
  await Promise.all(
    Array.from({ length: n }, async (_, seat) => {
      const r = await $.model
        .complete({
          model: 'haiku',
          maxTokens: 20,
          system: `You are ${PERSONAS[seat % PERSONAS.length]} on a panel deciding for a coding agent. Reply with the option number only.`,
          prompt: `Context: ${brief}\n\nQuestion: ${q}\n${menu}`,
        })
        .catch(() => null)
      const pick = Number((r?.isAnswered ? r.text : '').match(/\d+/)?.[0] ?? 1) - 1
      const vote = pick >= 0 && pick < opts.length ? pick : 0
      await set($, s => ({ decisions: s.decisions.map(d => (d.id === id ? { ...d, votes: d.votes.map((v, i) => (i === seat ? vote : v)) } : d)) }))
    }),
  )
  const d = (await read($, S)).decisions.find(x => x.id === id) as Decision
  const t = tally(d)
  const winner = d.opts[t.top] ?? ''
  if (!act) {
    const advice = t.passes ? `Judges recommend "${winner}" · ${t.yes}/${t.n}` : `Judges split ${t.counts.join('/')}: no clear pick`
    await set($, s => ({ decisions: s.decisions.map(x => (x.id === id ? { ...x, advice, status: x.status === 'you' ? 'you' : 'advised' } : x)) }))
    await toast($, advice)
    return t.passes ? winner : ''
  }
  await set($, s => ({
    decisions: s.decisions.map(x => (x.id === id ? { ...x, status: t.passes ? 'decided' : 'split', result: t.passes ? `${t.yes}/${t.n} → ${winner}` : `Split ${t.counts.join('/')} · asking you` } : x)),
  }))
  await toast($, t.passes ? `Judge ${t.yes}/${t.n} · ${winner}` : `Judges split ${t.counts.join('/')} · your call`)
  return t.passes ? winner : ''
}

// Answers the judges gave in a row with nobody's own prompt between: three, then the next decision is the person's
export async function personSpoke($: $, at: number) {
  await set($, { personAt: at, judgedRun: 0 })
}

// The app's next-step box: Claude ends a turn with a question and reply buttons. In Auto mode the judges vote between
// the buttons and the winner's reply is sent as the next prompt; they only advise where the decision is hard to undo,
// where they split, where the winner is an app action they cannot press, after three in a row, and in Ask me mode
export async function judgeNext($: $, input: Record<string, unknown>) {
  const s = await read($, S)
  const ask = typeof input.ask === 'string' ? input.ask.trim() : ''
  const acts = (Array.isArray(input.actions) ? input.actions : []) as { action?: string; label?: string; message?: string }[]
  // Off, no question, one button, or a question only you can answer (what you saw, did or want): left to you
  if (s.mode === 'off' || !ask || acts.length < 2 || PERSONAL.test(ask)) return
  const opts = acts.map(a => ({ label: a.label || a.action || 'Option', ...(a.message ? { description: a.message } : {}) }))
  const at = await $.clock.now()
  // The tool call's own id keeps two next steps apart
  const id = `next-${String(input.tool_use_id ?? '')}-${at}`
  await set($, st => ({ decisions: [...st.decisions, { id, q: ask, opts: opts.map(o => o.label), at, score: 0, signals: [], votes: [], status: 'scoring' as const, result: '', kind: 'next' as const }].slice(-50) }))
  const risky = RISKY.test([ask, ...acts.map(a => `${a.label ?? ''} ${a.message ?? ''}`)].join(' ')) || acts.some(a => a.action === 'merge' || a.action === 'create_pr')
  const canAct = s.mode === 'auto' && !risky && s.judgedRun < 3
  const win = await judge($, id, ask, opts, canAct)
  const choice = acts[opts.findIndex(o => o.label === win)]
  const d = (await read($, S)).decisions.find(x => x.id === id)
  if (!canAct || !win || !choice || choice.action) {
    const why = risky ? ': it is hard to undo, so it is yours to decide' : s.judgedRun >= 3 && s.mode === 'auto' ? ': three were answered in a row, so this one is yours' : choice?.action ? ': it is a button only you can press' : ''
    const text = d?.advice ?? (win ? `Judges recommend "${win}"` : d?.result ?? '')
    if (text) await note($, `⚖ ${text}${why}`)
    if (canAct && win && choice?.action) await set($, st => ({ decisions: st.decisions.map(x => (x.id === id ? { ...x, status: 'advised', advice: `Judges recommend "${win}"` } : x)) }))
    return
  }
  // Late: you sent a prompt of your own, or Claude asked a newer question, while the judges voted. Not sent
  const now = await read($, S)
  const mine = now.decisions.findIndex(x => x.id === id)
  if (now.personAt > at || now.decisions.some((x, i) => i > mine && x.kind === 'next')) {
    await set($, st => ({ decisions: st.decisions.map(x => (x.id === id ? { ...x, status: 'advised', advice: `Judges recommended "${choice.label}" (not sent: a newer question or your prompt came first)` } : x)) }))
    return
  }
  await set($, st => ({ judgedRun: st.judgedRun + 1 }))
  await note($, `⚖ Judges chose "${choice.label}" · ${d?.result ?? ''}`)
  await $.prompt.submit({ text: choice.message || choice.label || '' })
}

// Spawns started from the pane right now, each its type and exact prompt: the tool.check hook puts these to the person
const ownStarts: { type: string; prompt: string }[] = []
export function isOwnStart(input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>
  return ownStarts.some(o => o.type === (i.subagent_type ?? 'general-purpose') && o.prompt === i.prompt)
}

// Starts a subagent in the background and settles once it has started, with its id
export async function startAgent($: $, a: { prompt: string; description: string; type: string }) {
  const own = { type: a.type, prompt: a.prompt }
  ownStarts.push(own)
  const r = await $.agent.spawn({ prompt: a.prompt, description: a.description, subagentType: a.type })
    .catch(e => ({ deny: String(e) }))
    .finally(() => ownStarts.splice(ownStarts.indexOf(own), 1))
  if ('deny' in r && r.deny) return { deny: r.deny }
  return { agentId: 'agentId' in r && r.agentId ? r.agentId : '' }
}

// The experts from the mod's own agents/*.md, registered as cockpit:<name> so they dispatch however the mod was loaded
// (a plugin's agent files are read only at startup; a mod that loads later, or reloads, registers its own)
export async function registerExperts($: $) {
  const dir = `${$.plugin.root}/agents`
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (!f.name.endsWith('.md')) continue
    const text = await $.fs.read(`${dir}/${f.name}`).catch(() => '')
    const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!m) continue
    const head: Record<string, string> = Object.fromEntries((m[1] ?? '').split('\n').map(l => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]).filter(([k]) => k))
    const name = head.name || f.name.slice(0, -3)
    const tools = String(head.tools ?? '').split(',').map((t: string) => t.trim()).filter(Boolean)
    const spec = { name, description: head.description || `Cockpit's ${name}`, prompt: (m[2] ?? '').trim(), ...(head.model ? { model: head.model } : {}), ...(tools.length ? { tools } : {}) }
    await $.agent.register(spec).catch(e => $.ui.log(`cockpit: could not register the ${spec.name}: ${String(e)}`))
  }
  // And the agents made from a description, kept in the store across sessions
  const made = ((await $.store.get('agents').catch(() => undefined)) ?? []) as MadeAgent[]
  const custom: Ph['custom'] = []
  for (const m of made) {
    const r = await $.agent.register(m).catch(() => null)
    if (r) custom.push({ type: r.agent, name: expertName(r.agent), what: m.description })
  }
  await set($, { custom })
}

type MadeAgent = { name: string; description: string; prompt: string; tools?: string[] }
const TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch']

// An agent from the person's own words: a model writes its definition, Cockpit registers it as cockpit:<name>
// (runnable at once, here and by Claude) and keeps it in the store for later sessions
export async function createAgent($: $, describe: string) {
  if ((await read($, S)).creating) return toast($, 'Still making the last agent')
  await set($, { creating: describe })
  try {
    const r = await $.model.complete({
      model: 'sonnet',
      maxTokens: 3000,
      system: 'You write Claude Code subagent definitions. Answer with one JSON object and nothing else.',
      prompt: `The person wants this agent:\n${describe}\n\nAnswer with JSON: {"name": short kebab-case, 2 to 40 characters, "description": one line saying what it does and when to use it, "tools": the tools it needs from ${JSON.stringify(TOOLS)}, or [] for every tool, "prompt": its whole system prompt in the second person: its role, how it works step by step, what it must not do, and that its answer ends with a line "REPORT: <one line of what it found or did>" and a line "HANDOFF: <what the next agent should look at>"}`,
    })
    const json = r.isAnswered ? r.text.match(/\{[\s\S]*\}/)?.[0] : undefined
    const raw = json ? (JSON.parse(json) as Partial<MadeAgent>) : {}
    const name = String(raw.name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    if (!name || !raw.description || !raw.prompt) return toast($, r.isAnswered ? 'Could not make the agent: the definition came back incomplete' : `Could not make the agent: ${r.reason}`)
    if (EXPERTS.some(x => x.type === `cockpit:${name}`)) return toast($, `"${name}" is one of Cockpit's own experts: describe it differently`)
    const tools = (Array.isArray(raw.tools) ? raw.tools : []).filter(t => TOOLS.includes(t))
    const spec: MadeAgent = { name, description: String(raw.description), prompt: String(raw.prompt), ...(tools.length ? { tools } : {}) }
    const reg = await $.agent.register(spec).catch(e => ({ deny: String(e) }))
    if ('deny' in reg) return toast($, `Could not register the agent: ${reg.deny}`)
    const made = ((await $.store.get('agents').catch(() => undefined)) ?? []) as MadeAgent[]
    await $.store.set('agents', [...made.filter(m => m.name !== name), spec])
    await set($, s => ({
      custom: [...s.custom.filter(c => c.type !== reg.agent), { type: reg.agent, name: expertName(reg.agent), what: spec.description }],
      agentTypes: s.agentTypes.includes(reg.agent) ? s.agentTypes : [...s.agentTypes, reg.agent],
      ui: { ...s.ui, describe: '', spawnOpen: false },
    }))
    await toast($, `Made the ${expertName(reg.agent)} agent: it is on the team board, and ▶ runs it from your next prompt on`)
  } catch (e) {
    await toast($, `Could not make the agent: ${String(e)}`)
  } finally {
    await set($, { creating: '' })
  }
}

// An expert's brief: the task, the files touched, and the reports of the experts before it
function expertPrompt(s: Ph, prior: string[]) {
  const touched = [...new Set(s.ops.filter(o => o.op === 'Write' || o.op === 'Edit').map(o => o.path))].slice(-12)
  // From the codebase memory: the files that import what changed, which the change reaches too
  const by = importers(s.memory.files)
  const keys = touched.map(p => memoryKey(s.memory.files, p)).filter(Boolean)
  const reach = [...new Set(keys.flatMap(k => by[k] ?? []))].filter(f => !keys.includes(f)).slice(0, 20)
  return `Task: ${s.task || '(see the git diff)'}\nChanged files: ${touched.join(', ') || '(see git diff)'}${reach.length ? `\nAlso affected (they import the changed files): ${reach.join(', ')}` : ''}\n\nPRIOR REPORTS:\n${prior.length ? prior.map((r, i) => `--- ${i + 1} ---\n${r}`).join('\n\n') : '(none: you are first)'}`
}

// Starts one expert; returns its agent id ('' when the start handed none back: the agent.spawn hook records it), or null when refused
// Prompts Cockpit sends to hand a refused start to Claude: they open no flow and write no steps of their own
// The lines Cockpit sends to hand an agent start to Claude: they open no flow
export const handoffs = new Set<string>()
let handoffSeq = 0

// Auto mode judges a subagent by the request to the model that asked for it, and a press in the pane is none, so it
// refuses with "no verdict". The start then goes to Claude as one short line in the conversation, and Claude starts the
// agent in that turn (auto mode judges it like any agent Claude starts); the agent.spawn hook tracks it and binds it to a
// waiting pipeline step. The brief rides in a file the line names (in .cockpit/, kept out of git), so it arrives even
// where another plugin's hook keeps Cockpit's own prompt hooks from running; inline where no file can be written.
// It never waits for that turn: a press, a command and a turn's end all return at once
export async function handOff($: $, items: { type: string; brief: string }[]) {
  if (!items.length) return false
  const dir = await cockpitDir($)
  // ponytail: one small file a hand-off, never pruned; .cockpit/ is git-ignored
  const parts = await Promise.all(
    items.map(async ({ type, brief }) => {
      const file = dir ? `${dir}/handoffs/${type.replace(/[^a-z0-9]+/gi, '-')}-${await $.clock.now()}-${++handoffSeq}.md` : ''
      const wrote = !!file && (await $.fs.write(file, brief).then(() => true).catch(() => false))
      return { type, brief, file: wrote ? file : '' }
    }),
  )
  const name = parts.length === 1 ? expertName(parts[0]!.type) : `${parts.length} agents`
  const one = parts[0]!
  const text =
    parts.length === 1
      ? one.file
        ? `▶ Start the ${name}: run the ${one.type} agent in the background; its brief is in ${one.file}`
        : `▶ Start the ${name}: run the ${one.type} agent in the background with this brief:\n\n${one.brief}`
      : `▶ Start ${name}: run each in the background, all at once, each with its own brief:\n${parts.map(p => (p.file ? `- ${p.type}: brief in ${p.file}` : `- ${p.type}, with this brief:\n${p.brief}`)).join('\n')}`
  handoffs.add(text)
  const failed = async () => {
    handoffs.delete(text)
    await note($, `⧉ ${name} could not start: ${parts.length === 1 ? 'it' : 'they'} could not be handed to Claude`)
  }
  const send = async () => {
    const r = await $.prompt.submit({ text })
    if ('drop' in r && r.drop) await failed()
  }
  await toast($, `Starting ${parts.length === 1 ? `the ${name.toLowerCase()}` : name}…`)
  // Where the engine refuses the prompt from here (inside a command's hook, which holds the turn it would wait on), it
  // goes from a timer once that hook has returned
  void send().catch(() => {
    try {
      $.clock.after(20, () => {
        void send().catch(() => failed())
      })
    } catch {
      void failed()
    }
  })
  return true
}

export async function runExpert($: $, type: string, prior: string[] = [], opts: { task?: string; batch?: { type: string; brief: string }[] } = {}) {
  const s0 = await read($, S)
  const s = opts.task ? { ...s0, task: opts.task } : s0
  const name = expertName(type)
  await set($, { starting: { name, type, task: s.task || name } })
  const r = await startAgent($, { prompt: expertPrompt(s, prior), description: name, type })
  await set($, { starting: null })
  if ('deny' in r) {
    // Refused for want of a request: Claude starts it instead; '' keeps a pipeline waiting on this step
    if (/no verdict/i.test(r.deny ?? '')) {
      if (opts.batch) return (opts.batch.push({ type, brief: expertPrompt(s, prior) }), '')
      if (await handOff($, [{ type, brief: expertPrompt(s, prior) }])) return ''
    }
    // In the chat too: a toast is gone in seconds and never reaches the transcript
    await note($, `⧉ ${name} could not start: ${r.deny}`)
    await toast($, `${name} could not start: ${r.deny}`)
    return null
  }
  if (r.agentId) await trackAgent($, { id: r.agentId, name, type, task: s.task || name, prompt: expertPrompt(s, prior) })
  await toast($, `Started the ${name.toLowerCase()}`)
  return r.agentId
}

// A start in flight: a second press while the first expert is still being spawned is refused, not doubled
let startingPipeline = false

// A pipeline: the experts in turn, each handed the reports so far
export async function startPipeline($: $, name: string, opts: { for?: string; prior?: string[] } = {}) {
  const def = PIPELINES.find(p => p.name === name)
  if (!def) return
  const s = await read($, S)
  // A pipeline whose expert never got an id (nothing can ever finish it) is stale and gives way
  if (startingPipeline || s.pipeline?.agentId) return toast($, `${PIPELINES.find(p => p.name === s.pipeline?.name)?.label ?? 'A pipeline'} is still running`)
  startingPipeline = true
  try {
    const at = await $.clock.now()
    await set($, st => ({
      pipeline: { name, steps: def.steps, index: 0, agentId: '', reports: opts.prior ?? [], at, ...(opts.for ? { for: opts.for } : {}) },
      // Verify counts toward the flow it tests: the last one, running or just closed; before any prompt there is none
      ...(st.flows.length ? { reached: st.reached.includes('Verify') ? st.reached : [...st.reached, 'Verify'] } : {}),
      flows: st.flows.map((f, i) => (i === st.flows.length - 1 && !f.reached.includes('Verify') ? { ...f, reached: [...f.reached, 'Verify'] } : f)),
    }))
    await bindExpert($, await runExpert($, def.steps[0] ?? '', opts.prior ?? []))
  } finally {
    startingPipeline = false
  }
}

// The started expert's id on the pipeline: the call's, else the one the agent.spawn hook recorded; a refusal ends the pipeline
async function bindExpert($: $, id: string | null) {
  if (id === null) return set($, { pipeline: null })
  await set($, st => (st.pipeline ? { pipeline: { ...st.pipeline, agentId: st.pipeline.agentId || id } } : {}))
}

// The agent that just finished was the pipeline's: keep its report and start the next expert, or finish
export async function advancePipeline($: $, agentId: string, answer: string, aborted = false) {
  const s = await read($, S)
  const p = s.pipeline
  if (!p || p.agentId !== agentId) return
  if (aborted) {
    await set($, { pipeline: null })
    return toast($, `${PIPELINES.find(x => x.name === p.name)?.label ?? p.name} pipeline stopped: the ${expertName(p.steps[p.index] ?? '').toLowerCase()} was stopped`)
  }
  const reports = [...p.reports, `${expertName(p.steps[p.index] ?? '')}:\n${parseReport(answer)}`]
  const index = p.index + 1
  const next = p.steps[index]
  if (!next) {
    await set($, { pipeline: null })
    const label = PIPELINES.find(x => x.name === p.name)?.label ?? p.name
    await toast($, `${label} pipeline done`)
    await note($, `⧉ ${label} pipeline done · ${reports.length} experts`)
    const after = await read($, S)
    if (p.name === 'verify' && after.git.commitMode !== 'manual' && after.git.autoWhen === 'tests' && verifyState(after.agents).passed) {
      // The testers may have written files since the turn's end read the repository
      await refreshRepo($)
      await decideCommit($)
    }
    return
  }
  await set($, { pipeline: { ...p, index, reports, agentId: '' } })
  await bindExpert($, await runExpert($, next, reports))
}

// An agent's answer arrived: its cases and report go on its record
export async function finishAgent($: $, agentId: string, answer: string, aborted: boolean, failed = false) {
  const at = await $.clock.now()
  const cases = parseCases(answer)
  const report = parseReport(answer)
  await set($, s => ({ agents: s.agents.map(a => (a.id === agentId && (a.status === 'running' || (a.status !== 'stopped' && !a.report && !a.cases.length)) ? { ...a, status: aborted ? 'stopped' : failed ? 'failed' : 'done', endedAt: at, cases, report, log: [...a.log, { at, t: failed ? 'Failed · the run ended on an error' : 'Done · report ready' }] } : a)) }))
  const a = (await read($, S)).agents.find(x => x.id === agentId)
  if (a && cases.length) {
    const fail = cases.filter(c => c.st === 'fail').length
    await toast($, `${a.name}: ${cases.length - fail}/${cases.length} passed${fail ? ` · ${fail} failing` : ''}`)
    await note($, `${fail ? '✗' : '✓'} ${a.name} · ${cases.length - fail}/${cases.length} passed${fail ? ` · ${fail} failing` : ''}`)
  }
}

export async function trackAgent($: $, a: Pick<Agent, 'id' | 'name' | 'type' | 'task' | 'prompt'>) {
  const at = await $.clock.now()
  // Started twice (our own spawn, then its agent.spawn event): keep the first record's log and count.
  // A tester a Verify pipeline started on an agent's work is tagged with that agent
  await set($, s => {
    const was = s.agents.find(x => x.id === a.id)
    const p = s.pipeline
    const tests = was?.for ?? (p?.for && p.steps[p.index] === a.type ? p.for : undefined)
    return { agents: [...s.agents.filter(x => x.id !== a.id), { ...was, ...a, status: was && was.status !== 'running' ? was.status : ('running' as const), startedAt: was?.startedAt ?? at, tools: was?.tools ?? 0, log: was?.log ?? [], cases: was?.cases ?? [], report: was?.report ?? '', ...(tests ? { for: tests } : {}) }].slice(-40) }
  })
}

// The positive and the negative tester
export const TESTERS = ['cockpit:prover', 'cockpit:breaker']
// A run that wrote or edited a file
export const changedFiles = (a: Agent) => a.log.some(l => /^(Edit|Write|NotebookEdit|MultiEdit) /.test(l.t))

// Tests an agent's run: the Verify pipeline (the Prover proves it works, then the Breaker tries to break it), briefed
// with what that agent was asked and reported. auto: after a run that changed files, while the setting is on, and
// never on a tester's own run or while another pipeline runs
export async function testAgent($: $, id: string, auto: boolean) {
  const s = await read($, S)
  const a = s.agents.find(x => x.id === id)
  if (!a || a.status !== 'done' || TESTERS.includes(a.type)) return
  if (auto && (!s.testAgents || !changedFiles(a) || s.pipeline)) return
  const prior = [`${a.name} (the agent whose work you are testing):\nIts task: ${a.task}\n${a.report || '(it left no report: read the files it changed)'}`]
  await startPipeline($, 'verify', { for: id, prior })
}

// Agent types the model can dispatch: the built-ins, the project's and your own agents/*.md, each installed plugin's as <plugin>:<name>, and any type seen starting
export async function discoverAgentTypes($: $) {
  const names = async (dir: string) => (await $.fs.list(dir).catch(() => [])).filter(e => e.name.endsWith('.md')).map(e => e.name.slice(0, -3))
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
  const found = [...(await names('.claude/agents')), ...(home ? await names(`${home}/.claude/agents`) : [])]
  if (home) {
    const cache = `${home}/.claude/plugins/cache`
    for (const mk of await $.fs.list(cache).catch(() => [])) {
      for (const pl of await $.fs.list(`${cache}/${mk.name}`).catch(() => [])) {
        for (const ver of await $.fs.list(`${cache}/${mk.name}/${pl.name}`).catch(() => [])) {
          for (const n of await names(`${cache}/${mk.name}/${pl.name}/${ver.name}/agents`)) found.push(`${pl.name}:${n}`)
        }
      }
    }
  }
  await set($, s => ({ agentTypes: [...new Set([...AGENT_TYPES, ...s.agentTypes, ...found, ...s.agents.map(a => a.type)])] }))
}

export async function spawnAgent($: $, task: string, type: string) {
  await set($, { starting: { name: expertName(type) === type && type === 'general-purpose' ? 'Agent' : expertName(type), type, task } })
  const r = await startAgent($, { prompt: task, description: task.slice(0, 60), type })
  await set($, { starting: null })
  if ('deny' in r) {
    if (/no verdict/i.test(r.deny ?? '') && (await handOff($, [{ type, brief: task }]))) return set($, s => ({ ui: { ...s.ui, spawnOpen: false, spawnTask: '' } }))
    await note($, `⧉ ${type} could not start: ${r.deny}`)
    return toast($, `Could not start the agent: ${r.deny}`)
  }
  if (r.agentId) await trackAgent($, { id: r.agentId, name: type === 'general-purpose' ? 'Agent' : type, type, task, prompt: task })
  await set($, s => ({ ui: { ...s.ui, spawnOpen: false, spawnTask: '', openAgent: r.agentId } }))
  await toast($, `Started ${type}`)
}

// Several agents at once, each a run of its own with the same task (the current one where none is given); where auto
// mode refuses them for want of a request, they go to Claude together, in one line
export async function runMany($: $, types: string[], task = '') {
  if (!types.length) return toast($, 'Tick the agents to run first')
  const batch: { type: string; brief: string }[] = []
  for (const type of types) await runExpert($, type, [], { ...(task ? { task } : {}), batch })
  await handOff($, batch)
  await set($, s => ({ ui: { ...s.ui, selected: {}, runTask: '' } }))
}

// The context window, made room in: Compact keeps a summary in the conversation's place (as /compact does), Clear starts
// the conversation afresh (as /clear does; the transcript stays in your history). Both wait for the session to be idle
export async function compactNow($: $) {
  const r = await $.session.compact({}).catch(e => ({ skip: String(e).includes('turn') ? 'a turn is running: try again when it ends' : String(e) }))
  await toast($, 'skip' in r && r.skip ? `Not compacted: ${r.skip}` : 'Compacted: a summary keeps the conversation')
  await measure($)
}
export async function clearNow($: $) {
  await set($, s => ({ ui: { ...s.ui, confirmClear: false } }))
  const r = await $.command.run({ command: 'clear' }).catch(e => ({ text: `Could not clear: ${String(e)}` }))
  await toast($, 'text' in r && r.text?.startsWith('Could not') ? r.text : 'Context cleared')
  await measure($)
}

// The session's agents as the engine lists them, Claude's subagents included: one Cockpit never heard start (another
// plugin's hook can run before its own) joins the Agents tab, and one it never heard end is settled
export async function syncAgents($: $) {
  const list = await $.agent.list().catch(() => null)
  if (!list?.length) return
  const at = await $.clock.now()
  await set($, s => {
    let agents = s.agents
    for (const a of list) {
      // Cleared from the list by you: the engine still lists it, and it stays cleared
      if (s.cleared.includes(a.id)) continue
      const st = a.status === 'completed' ? 'done' : a.status === 'failed' ? 'failed' : a.status === 'killed' ? 'stopped' : 'running'
      const was = agents.find(x => x.id === a.id)
      const name = expertName(a.type) !== a.type ? expertName(a.type) : a.description || a.type
      if (!was) agents = [...agents, { id: a.id, name, type: a.type, task: a.description, prompt: '', status: st, startedAt: at, ...(st !== 'running' ? { endedAt: at } : {}), tools: 0, log: [], cases: [], report: '' }]
      else if (was.status === 'running' && st !== 'running') agents = agents.map(x => (x.id === a.id ? { ...x, status: st, endedAt: at } : x))
    }
    return agents === s.agents ? {} : { agents: agents.slice(-40) }
  })
}

// An agent run again with your instructions: a run's own brief with them added, or a team agent with them as its task
export async function rerun($: $, target: string, text: string) {
  const s = await read($, S)
  const said = text.trim()
  await set($, st => ({ ui: { ...st.ui, rerunFor: '', rerunText: '' } }))
  if (target.startsWith('type:')) return runExpert($, target.slice(5), [], said ? { task: said } : {})
  const a = s.agents.find(x => x.id === target)
  if (!a) return
  const known = EXPERTS.some(x => x.type === a.type) || s.custom.some(c => c.type === a.type)
  if (known) return runExpert($, a.type, [], { task: said ? `${a.task}\n\nInstructions for this run: ${said}` : a.task })
  return spawnAgent($, said ? `${a.prompt || a.task}\n\nInstructions for this run: ${said}` : a.prompt || a.task, a.type)
}

// Every running agent, stopped
export async function stopAll($: $) {
  const live = (await read($, S)).agents.filter(a => a.status === 'running')
  for (const a of live) await stopAgent($, a.id, true)
  await toast($, live.length ? `Stopped ${live.length} agent${live.length === 1 ? '' : 's'}` : 'Nothing running')
}

// The finished runs off the list; they stay in .cockpit/history.json
export async function clearFinished($: $) {
  await saveHistory($)
  const at = await $.clock.now()
  await set($, s => ({
    cleared: [...s.cleared, ...s.agents.filter(a => a.status !== 'running').map(a => a.id)].slice(-300),
    clearedAt: at,
    agents: s.agents.filter(a => a.status === 'running'),
    // saveHistory writes the file from pastAgents and agents: the cleared runs stay there
    pastAgents: [...s.pastAgents.filter(p => !s.agents.some(a => a.id === p.id)), ...s.agents.filter(a => a.status !== 'running').map(summary)],
    ui: { ...s.ui, openAgent: '' },
  }))
}

export async function stopAgent($: $, id: string, quiet = false) {
  const r = await $.tool.call({ tool: 'TaskStop', task_id: id, consent: 'The user pressed "Stop" on an agent in the Cockpit pane' }).catch(e => ({ deny: String(e) }))
  const ok = !('deny' in r && r.deny) && !('isError' in r && r.isError)
  const at = await $.clock.now()
  if (ok) await set($, s => ({ agents: s.agents.map(a => (a.id === id && a.status === 'running' ? { ...a, status: 'stopped', endedAt: at, log: [...a.log, { at, t: 'Stopped by you' }] } : a)), pipeline: s.pipeline?.agentId === id ? null : s.pipeline }))
  if (!quiet || !ok) await toast($, ok ? 'Stopped the agent' : `Could not stop it: ${'deny' in r && r.deny ? r.deny : ('text' in r && r.text) || ''}`)
}

// Refresh context fill, its breakdown and cost
export async function measure($: $) {
  const u = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  if (!u) return
  const cats = (u.context.breakdown?.categories ?? []).filter(c => c.tokens > 0 && !/free|buffer/i.test(c.name))
  const segs = cats
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 4)
    .map(c => [c.name, c.tokens] as [string, number])
  // Before the first API response `tokens` is unset: the breakdown's total stands in
  const used = u.context.tokens ?? u.context.breakdown?.totalTokens ?? 0
  const pct = u.context.percent ?? (u.context.window ? Math.round((used / u.context.window) * 100) : 0)
  await set($, {
    ctx: { pct, used, window: u.context.window, segs },
    cost: u.cost?.usd ?? 0,
  })
}

export async function openPane($: $) {
  return $.ui.open({ id: PANE, title: 'Cockpit' })
}

// The Git tab's settings, kept per repository across sessions: what you chose stays until you change it
const GIT_PREFS: (keyof GitForm)[] = ['branchAuto', 'branchPattern', 'ticket', 'user', 'base', 'type', 'msgPattern', 'commitMode', 'autoWhen', 'setupDone', 'breaking', 'push', 'pr', 'draft', 'signoff', 'gpg', 'preTest']
async function prefsKey($: $) {
  return `git:${await repoRoot($)}`
}
// Settings saved under a session folder inside the repository (before they were kept per repository) move to it
async function moveSaved($: $, kind: 'git' | 'account') {
  const cwd = await $.session.cwd().catch(() => '')
  const root = await repoRoot($)
  if (!cwd || cwd === root) return
  const old = await $.store.get(`${kind}:${cwd}`)
  if (old === undefined || old === null) return
  await $.store.set(`${kind}:${root}`, old)
  await $.store.set(`${kind}:${cwd}`, null)
}

// The current flow's template, chosen by hand
export function pickFlow($: $, kind: string) {
  return set($, st => ({ flows: st.flows.map((f, i) => (i === st.flows.length - 1 ? { ...f, kind } : f)) }))
}

export async function setGit($: $, patch: Partial<GitForm>) {
  await set($, s => ({ git: { ...s.git, ...patch } }))
  const g = (await read($, S)).git
  await $.store.set(await prefsKey($), Object.fromEntries(GIT_PREFS.map(k => [k, g[k]])))
}

export async function loadGitPrefs($: $) {
  await moveSaved($, 'git')
  const saved = (await $.store.get(await prefsKey($))) as Partial<GitForm> | undefined
  if (saved) await set($, s => ({ git: { ...s.git, ...saved } }))
}

// Switch theme; the pane repaints its backdrop from state
export async function setTheme($: $, theme: ThemeId) {
  await set($, { theme })
  await openPane($)
  await toast($, `Theme: ${theme}`)
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
  // One block per login: "Logged in to github.com account <login> ..." then its "- Active account: true|false"
  const blocks = out.split(/Logged in to /).slice(1)
  const logins = blocks.map(b => b.match(/account (\S+)/)?.[1] ?? '').filter(Boolean)
  const active = blocks.find(b => /Active account: true/.test(b))?.match(/account (\S+)/)?.[1] ?? logins[0] ?? ''
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
  await set($, { accounts, accountId: accounts.some(a => a.id === chosen) ? chosen : (accounts[0]?.id ?? '') })
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
