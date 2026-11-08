import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Account, Agent, Autopilot, Changed, RuleFiles, Commit, Decision, Flow, GitForm, Pending, Ph, ThemeId, PlanItem } from '../../types'
import { changeMcp, mcpRows, parseSettings, settingsText } from '../rules'
import { factsOf, featurePrompt, filesSig, importers, isCode, memoryKey, memoryMarkdown, parseFeatures, parseImports, resolveImport } from '../memory'
import { AGENT_TYPES, EXPERTS, PIPELINES, TYPES, recallOf, similarRuns, parseCommit, parseSteps, base, branchName, commitMsg, expertName, inferType, nJ, parseCases, parseReport, tally, verifyState } from '../logic'
import { INITIAL, PANE } from '../state'
import { THEME_IDS } from '../theme'
import type { $ } from './core'
import { repoRoot, set, toast } from './core'

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
  return { path, text, rows: mcpRows(parseSettings(text).json, claude, [parseSettings(files.repo.settings).json, parseSettings(files.user.settings).json], root) }
}
export async function loadRules($: $) {
  const files = await ruleFiles($)
  await set($, { rules: { ...files, mcp: await mcpFiles($, files) } })
}
// A change to the project's .mcp.json, read again first; one that is not valid JSON is never written
export async function writeMcp($: $, op: Parameters<typeof changeMcp>[1], what: string) {
  const f = await mcpFiles($, await ruleFiles($))
  const { json, error } = parseSettings(f.text)
  // Refused, and read again, so the tab shows it read-only
  if (error) return Promise.all([loadRules($), toast($, `${f.path} is ${error}: fix it by hand first; Cockpit will not overwrite it`)])
  const next = changeMcp(json, op)
  if (JSON.stringify(next) === JSON.stringify(json)) return Promise.all([loadRules($), toast($, 'Nothing changed: the name is taken, or the file moved since it was shown and was read again')])
  await $.fs.write(f.path, settingsText(next)).catch(e => toast($, `Could not write ${f.path}: ${String(e)}`))
  await loadRules($)
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
