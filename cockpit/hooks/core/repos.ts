import type { $ } from './core'
import { look, set } from './core'

// The branch a `git status --porcelain -b` header names: "## main...origin/main [ahead 1]", "## No commits yet on main"
export const branchOf = (head: string) => head.replace(/^## (No commits yet on )?/, '').split('...')[0] ?? ''

// With several repos found, each one's branch and changed-file count for the picker
export async function repoInfo($: $) {
  const repos = (await look($)).repos
  if (repos.length < 2) return
  const info = await Promise.all(
    repos.map(async r => {
      const o = await $.process.run(['git', 'status', '--porcelain=v1', '-b'], { cwd: r.dir }).catch(() => ({ exitCode: 1, stdout: '' }))
      const [head = '', ...rest] = o.stdout.split('\n')
      return { ...r, branch: branchOf(head), changed: rest.filter(Boolean).length }
    }),
  )
  await set($, { repos: info })
}

// Folders no walk goes into
export const SKIP = (n: string) => n.startsWith('.') || n === 'node_modules'
// The git repos one or two levels under a folder that is not itself in one (a folder with a .git directory or file)
// ponytail: two levels and 20 repos; deeper layouts pick by hand or open the session in the repo. Under a repository
// (below) the same walk finds the repos it holds: submodules and nested clones
async function findRepos($: $, cwd: string) {
  const out: string[] = []
  const isRepo = (d: string) => $.fs.exists(`${d}/.git`).catch(() => false)
  const dirs = async (d: string) => (await $.fs.list(d).catch(() => [])).filter(e => e.kind === 'dir' && !SKIP(e.name)).map(e => `${d}/${e.name}`)
  for (const a of await dirs(cwd)) {
    if (out.length >= 20) break
    if (await isRepo(a)) out.push(a)
    else for (const b of await dirs(a)) if (out.length < 20 && (await isRepo(b))) out.push(b)
  }
  return out
}

// The repository's top folder, per session folder: git names changed files from there, so a session working in a
// subfolder (cockpit/) must run git there too, or `git add cockpit/x` looks for cockpit/cockpit/x
const roots = new Map<string, { top: string; repos: string[] }>()
// What was found is forgotten, so the next reading looks again: after a git init, and on Refresh (a clone made
// meanwhile, a repository deleted)
export function rediscover() {
  roots.clear()
}
export async function repoRoot($: $) {
  const cwd = await $.session.cwd().catch(() => '')
  let k = roots.get(cwd)
  const fresh = k === undefined
  if (k === undefined) {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel']).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }))
    const inRepo = r.exitCode === 0 && /^([A-Za-z]:)?[\\/]/.test(r.stdout.trim())
    const top = inRepo ? r.stdout.trim() : cwd
    // The repos under it: a folder of repos, or a repository that holds others, itself first
    const under = top ? await findRepos($, top) : []
    k = { top, repos: inRepo ? (under.length ? [top, ...under] : []) : under }
    roots.set(cwd, k)
  }
  const found = k
  if (!found.repos.length) {
    // One repository, or none: a picker left from before a git init or a Refresh goes
    if (fresh && (await look($)).repos.length) await set($, { repos: [], repoDir: '' })
    return found.top
  }
  const s = await look($)
  if (!fresh && s.repoDir && found.repos.includes(s.repoDir)) return s.repoDir
  const saved = await $.store.get(`repo:${cwd}`).catch(() => undefined)
  const dir = found.repos.find(d => d === s.repoDir) ?? found.repos.find(d => d === saved) ?? found.repos[0] ?? cwd
  const name = (d: string) => (d === found.top ? d.replace(/^.*[\\/]/, '') : d.slice(found.top.length + 1))
  await set($, st => ({ repoDir: dir, repos: found.repos.map(d => st.repos.find(r => r.dir === d) ?? { dir: d, name: name(d), branch: '', changed: 0 }) }))
  return dir
}
export async function git($: $, args: string[]) {
  const cwd = await repoRoot($)
  return $.process.run(['git', ...args], cwd ? { cwd } : {}).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
}
export async function prefsKey($: $) {
  return `git:${await repoRoot($)}`
}
// Settings saved under a session folder inside the repository (before they were kept per repository) move to it
export async function moveSaved($: $, kind: 'git' | 'account') {
  const cwd = await $.session.cwd().catch(() => '')
  const root = await repoRoot($)
  // A folder of repos: the chosen repo is below the session folder, not its parent
  if (!cwd || cwd === root || root.startsWith(`${cwd}/`)) return
  const old = await $.store.get(`${kind}:${cwd}`)
  if (old === undefined || old === null) return
  await $.store.set(`${kind}:${root}`, old)
  await $.store.set(`${kind}:${cwd}`, null)
}

// Cockpit's folder in the repository, kept out of git (and so out of every commit) by its own .gitignore
export async function cockpitDir($: $) {
  const root = await repoRoot($)
  if (!root) return ''
  const dir = `${root}/.cockpit`
  if (!(await $.fs.exists(`${dir}/.gitignore`).catch(() => true))) await $.fs.write(`${dir}/.gitignore`, '# Cockpit keeps its history and codebase memory here, out of git\n*\n').catch(() => null)
  return dir
}
