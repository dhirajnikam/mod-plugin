import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Account, Agent, Autopilot, Changed, RuleFiles, SkillFile, Commit, Decision, Flow, GitForm, Pending, Ph, ThemeId, PlanItem } from '../../types'
import { changeMcp, mcpRows, parseSettings, setInvocation, settingsText, skillListed, skillOf } from '../rules'
import { factsOf, featurePrompt, filesSig, importers, isCode, memoryKey, memoryMarkdown, parseFeatures, parseImports, resolveImport } from '../memory'
import { AGENT_TYPES, EXPERTS, PIPELINES, TYPES, recallOf, similarRuns, parseCommit, parseSteps, base, branchName, commitMsg, expertName, inferType, nJ, parseCases, parseReport, tally, verifyState } from '../logic'
import { INITIAL, PANE } from '../state'
import { THEME_IDS } from '../theme'
import type { $ } from './core'
import { repoRoot, set, toast } from './core'

const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-23' })

// The Rules tab: the hooks, permission rules and instructions of the repository and of the user, read from their files
// and written back with the rest of each file kept. Each change reads the file again first, and a settings file that is
// not valid JSON is never written
async function ruleFiles($: $): Promise<{ repo: RuleFiles; user: RuleFiles }> {
  const root = (await repoRoot($)) || '.'
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
  const text = (p: string) => $.fs.read(p).then(String).catch(() => '')
  // The repository's CLAUDE.md is at its root, or in .claude/ when only that one exists
  const repoMd = (await $.fs.exists(`${root}/CLAUDE.md`).catch(() => false)) || !(await $.fs.exists(`${root}/.claude/CLAUDE.md`).catch(() => false)) ? `${root}/CLAUDE.md` : `${root}/.claude/CLAUDE.md`
  const one = async (settingsPath: string, mdPath: string) => ({ settingsPath, settings: await text(settingsPath), mdPath, md: await text(mdPath) })
  return { repo: await one(`${root}/.claude/settings.json`, repoMd), user: await one(home ? `${home}/.claude/settings.json` : '', home ? `${home}/.claude/CLAUDE.md` : '') }
}
// MCP servers: the project's .mcp.json, and ~/.claude.json, Claude Code's own state file, which is only read
async function mcpFiles($: $, files: { repo: RuleFiles; user: RuleFiles }) {
  const root = (await repoRoot($)) || '.'
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
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
export async function loadRules($: $) {
  const files = await ruleFiles($)
  const root = (await repoRoot($)) || '.'
  const home = ((await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? '').replace(/\\/g, '/')
  // The repository being your home folder: its skills are yours, listed once
  const mine = home && home.replace(/\/+$/, '') !== root.replace(/\\/g, '/').replace(/\/+$/, '') ? `${home}/.claude/skills` : ''
  const [mcp, repo, user] = await Promise.all([mcpFiles($, files), skillFiles($, `${root}/.claude/skills`), skillFiles($, mine)])
  await set($, { rules: { ...files, mcp: mcp.file, skills: { repo, user } } })
}
// A skill switched between Claude loading it by itself and /name only: its SKILL.md read again first, only that
// line changed, and a file whose frontmatter cannot be read never written
export async function writeSkill($: $, path: string, auto: boolean) {
  // Only a SKILL.md the tab listed is ever written
  if (!skillListed(path, (await read($, S)).rules?.skills)) return loadRules($)
  const text = await $.fs.read(path).then(String).catch(() => null)
  if (text === null) return Promise.all([loadRules($), toast($, `${path} is gone: the skills were read again`)])
  const next = setInvocation(text, auto)
  if (next === null) return Promise.all([loadRules($), toast($, `${path}: ${skillOf(text).error}; fix it by hand first, Cockpit will not change it`)])
  if (next === text) return loadRules($)
  // Read once more just before writing: an edit made meanwhile is kept, not written over
  // ponytail: the engine has no lock or compare-and-swap; what is left is the gap between this read and the write
  const now = await $.fs.read(path).then(String).catch(() => null)
  if (now !== text) return Promise.all([loadRules($), toast($, `${path} changed while it was being switched: nothing was written, and the skills were read again`)])
  const failed = await $.fs.write(path, next).then(() => false, async e => (await toast($, `Could not write ${path}: ${String(e)}`), true))
  await loadRules($)
  if (!failed) await toast($, `${auto ? 'Claude may load it by itself' : 'Only when you call it'} · ${path}`)
}
// A change to the project's .mcp.json, read again first; one that is not valid JSON is never written
export async function writeMcp($: $, op: Parameters<typeof changeMcp>[1], what: string) {
  const { file: f, json } = await mcpFiles($, await ruleFiles($))
  // Refused, and read again, so the tab shows it read-only
  if (f.error) return Promise.all([loadRules($), toast($, `${f.path} is ${f.error}: fix it by hand first; Cockpit will not overwrite it`)])
  const next = changeMcp(json, op)
  if (JSON.stringify(next) === JSON.stringify(json)) return Promise.all([loadRules($), toast($, 'Nothing changed: the name is taken or not allowed (letters, digits, _ and -), or the file moved since it was shown and was read again')])
  const failed = await $.fs.write(f.path, settingsText(next)).then(() => false, async e => (await toast($, `Could not write ${f.path}: ${String(e)}`), true))
  await loadRules($)
  if (failed) return
  await toast($, `${what} · ${f.path}`)
}
export async function writeSettings($: $, scope: 'repo' | 'user', change: (j: Record<string, unknown>) => Record<string, unknown>, what: string) {
  const f = (await ruleFiles($))[scope]
  if (!f.settingsPath) return toast($, 'No home folder found for the user settings')
  const { json, error } = parseSettings(f.settings)
  if (error) return toast($, `${f.settingsPath} is ${error}: fix it by hand first; Cockpit will not overwrite it`)
  const next = change(json)
  if (JSON.stringify(next) === JSON.stringify(json)) return Promise.all([loadRules($), toast($, 'Nothing changed: the file moved since it was shown, so it was read again')])
  await $.fs.write(f.settingsPath, settingsText(next)).catch(e => toast($, `Could not write ${f.settingsPath}: ${String(e)}`))
  await loadRules($)
  await toast($, `${what} · ${f.settingsPath}`)
}
export async function writeInstructions($: $, scope: 'repo' | 'user', change: (md: string) => string, what: string) {
  const f = (await ruleFiles($))[scope]
  if (!f.mdPath) return toast($, 'No home folder found for the user instructions')
  const next = change(f.md)
  if (next === f.md) return Promise.all([loadRules($), toast($, 'Nothing changed: the file moved since it was shown, so it was read again')])
  await $.fs.write(f.mdPath, next).catch(e => toast($, `Could not write ${f.mdPath}: ${String(e)}`))
  await loadRules($)
  await toast($, `${what} · ${f.mdPath}`)
}
