import type { RuleFiles, SkillFile } from '../../types'
import type { $ } from '../core/core'
import { set, look, toast, homeDir } from '../core/core'
import { repoRoot } from '../core/repos'
import { parseSettings, mcpRows, skillOf, slashes, resolveMemory, memoryStarts, startupLoad, skillListed, setInvocation, changeMcp, settingsText, UNREAD } from './rules'
import type { MemoryRead } from './rules'

// The Rules tab: the hooks, permission rules and instructions of the repository and of the user, read from their files
// and written back with the rest of each file kept. Each change reads the file again first, and a settings file that is
// not valid JSON is never written
async function ruleFiles($: $): Promise<{ repo: RuleFiles; user: RuleFiles }> {
  const root = (await repoRoot($)) || '.'
  const home = await homeDir($)
  const text = (p: string) => $.fs.read(p).then(String).catch(() => '')
  // The repository's CLAUDE.md is at its root, or in .claude/ when only that one exists
  const repoMd = (await $.fs.exists(`${root}/CLAUDE.md`).catch(() => false)) || !(await $.fs.exists(`${root}/.claude/CLAUDE.md`).catch(() => false)) ? `${root}/CLAUDE.md` : `${root}/.claude/CLAUDE.md`
  const one = async (settingsPath: string, mdPath: string) => ({ settingsPath, settings: await text(settingsPath), mdPath, md: await text(mdPath) })
  return { repo: await one(`${root}/.claude/settings.json`, repoMd), user: await one(home ? `${home}/.claude/settings.json` : '', home ? `${home}/.claude/CLAUDE.md` : '') }
}
// MCP servers: the project's .mcp.json, and ~/.claude.json, Claude Code's own state file, which is only read
async function mcpFiles($: $, files: { repo: RuleFiles; user: RuleFiles }) {
  const root = (await repoRoot($)) || '.'
  const home = await homeDir($)
  const path = `${root}/.mcp.json`
  const text = await $.fs.read(path).then(String).catch(() => '')
  const claude = home ? parseSettings(await $.fs.read(`${home}/.claude.json`).then(String).catch(() => '')).json : {}
  // Approvals given at Claude Code's prompt are kept in settings.local.json
  const local = parseSettings(await $.fs.read(`${root}/.claude/settings.local.json`).then(String).catch(() => '')).json
  const { json, error } = parseSettings(text)
  const settings = [parseSettings(files.repo.settings).json, local, parseSettings(files.user.settings).json]
  return { file: { path, error, rows: mcpRows(json, claude, settings, root) }, json }
}
// Skills: each folder under .claude/skills with a SKILL.md in it, for the repository and for you
async function skillFiles($: $, dir: string): Promise<SkillFile[]> {
  if (!dir) return []
  // ponytail: the first 200 folders; a skills folder past that is not one a person reads in a tab
  const folders = (await $.fs.list(dir).catch(() => [])).filter(e => e.kind !== 'file' && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200)
  const out = await Promise.all(
    folders.map(async e => {
      const path = `${dir}/${e.name}/SKILL.md`
      const text = await $.fs.read(path).then(String).catch(() => null)
      return text === null ? null : { path, folder: e.name, ...skillOf(text) }
    }),
  )
  return out.filter((x): x is SkillFile => x !== null).sort((a, b) => a.folder.localeCompare(b.folder))
}
// Everything the Rules tab shows, read from the files again
export async function loadRules($: $) {
  const files = await ruleFiles($)
  const root = (await repoRoot($)) || '.'
  const home = (await homeDir($)).replace(/\\/g, '/')
  // The repository being your home folder: its skills are yours, listed once
  const mine = home && home.replace(/\/+$/, '') !== root.replace(/\\/g, '/').replace(/\/+$/, '') ? `${home}/.claude/skills` : ''
  const [mcp, repo, user] = await Promise.all([mcpFiles($, files), skillFiles($, `${root}/.claude/skills`), skillFiles($, mine)])
  // The memory files Claude Code loads at start, and what they import
  const cwd = (await $.session.cwd().catch(() => '')) || root
  const top = slashes(root)
  // ponytail: a file over 1 MB, or not a file, is listed but not read; a memory file that size is a mistake to see
  const readMemory = async (p: string): Promise<MemoryRead> => {
    const st = await $.fs.stat(p, { resolve: true }).catch(() => null)
    // Not there is one thing, there but unreadable another: only the first is a missing file
    if (!st) return (await $.fs.exists(p).catch(() => false)) ? { skipped: UNREAD } : null
    if (st.kind === 'dir') return null
    if (st.kind !== 'file') return { skipped: 'not a file' }
    if (st.size > 1_000_000) return { skipped: 'over 1 MB' }
    return $.fs.read(p).then(String).catch(() => ({ skipped: UNREAD }))
  }
  const memory = await resolveMemory(memoryStarts(cwd, home), readMemory, home, [top, home])
  const load = startupLoad(memory, [...repo, ...user], mcp.file.rows)
  const label = (p: string) => (p.startsWith(`${top}/`) ? p.slice(top.length + 1) : home && p.startsWith(`${home}/`) ? `~/${p.slice(home.length + 1)}` : p)
  load.files = load.files.map(f => ({ ...f, label: label(f.path), ...(f.via ? { via: label(f.via) } : {}) }))
  await set($, { rules: { ...files, mcp: mcp.file, skills: { repo, user }, load } })
}
// The tab read again, with a toast saying why nothing was written
function reread($: $, why: string) {
  return Promise.all([loadRules($), toast($, why)])
}
// The end of every change: the file written and the tab read again, then one toast, the failure's or the success's
async function writeAndReload($: $, path: string, text: string, done: string) {
  const failed = await $.fs.write(path, text).then(() => false, async e => (await toast($, `Could not write ${path}: ${String(e)}`), true))
  await loadRules($)
  if (!failed) await toast($, done)
}
// A skill switched between Claude loading it by itself and /name only: its SKILL.md read again first, only that
// line changed, and a file whose frontmatter cannot be read never written
export async function writeSkill($: $, path: string, auto: boolean) {
  // Only a SKILL.md the tab listed is ever written
  if (!skillListed(path, (await look($)).rules?.skills)) return loadRules($)
  const text = await $.fs.read(path).then(String).catch(() => null)
  if (text === null) return reread($, `${path} is gone: the skills were read again`)
  const next = setInvocation(text, auto)
  if (next === null) return reread($, `${path}: ${skillOf(text).error}; fix it by hand first, Cockpit will not change it`)
  if (next === text) return loadRules($)
  // Read once more just before writing: an edit made meanwhile is kept, not written over
  // ponytail: the engine has no lock or compare-and-swap; what is left is the gap between this read and the write
  const now = await $.fs.read(path).then(String).catch(() => null)
  if (now !== text) return reread($, `${path} changed while it was being switched: nothing was written, and the skills were read again`)
  await writeAndReload($, path, next, `${auto ? 'Claude may load it by itself' : 'Only when you call it'} · ${path}`)
}
// A change to the project's .mcp.json, read again first; one that is not valid JSON is never written
export async function writeMcp($: $, op: Parameters<typeof changeMcp>[1], what: string) {
  const { file: f, json } = await mcpFiles($, await ruleFiles($))
  // Refused, and read again, so the tab shows it read-only
  if (f.error) return reread($, `${f.path} is ${f.error}: fix it by hand first; Cockpit will not overwrite it`)
  const next = changeMcp(json, op)
  if (JSON.stringify(next) === JSON.stringify(json)) return reread($, 'Nothing changed: the name is taken or not allowed (letters, digits, _ and -), or the file moved since it was shown and was read again')
  await writeAndReload($, f.path, settingsText(next), `${what} · ${f.path}`)
}
// A change to the repository's or your settings.json, read again first; one that is not valid JSON is never written
export async function writeSettings($: $, scope: 'repo' | 'user', change: (j: Record<string, unknown>) => Record<string, unknown>, what: string) {
  const f = (await ruleFiles($))[scope]
  if (!f.settingsPath) return toast($, 'No home folder found for the user settings')
  const { json, error } = parseSettings(f.settings)
  if (error) return toast($, `${f.settingsPath} is ${error}: fix it by hand first; Cockpit will not overwrite it`)
  const next = change(json)
  if (JSON.stringify(next) === JSON.stringify(json)) return reread($, 'Nothing changed: the file moved since it was shown, so it was read again')
  await writeAndReload($, f.settingsPath, settingsText(next), `${what} · ${f.settingsPath}`)
}
// A change to the repository's or your CLAUDE.md, read again first
export async function writeInstructions($: $, scope: 'repo' | 'user', change: (md: string) => string, what: string) {
  const f = (await ruleFiles($))[scope]
  if (!f.mdPath) return toast($, 'No home folder found for the user instructions')
  const next = change(f.md)
  if (next === f.md) return reread($, 'Nothing changed: the file moved since it was shown, so it was read again')
  await writeAndReload($, f.mdPath, next, `${what} · ${f.mdPath}`)
}
