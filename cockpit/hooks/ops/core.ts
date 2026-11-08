import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Account, Agent, Autopilot, Changed, RuleFiles, Commit, Decision, Flow, GitForm, Pending, Ph, SessionSpend, ThemeId, PlanItem } from '../../types'
import { upsertSession } from '../spend'
import { parseSettings, settingsText } from '../rules'
import { factsOf, featurePrompt, filesSig, importers, isCode, memoryKey, memoryMarkdown, parseFeatures, parseImports, resolveImport } from '../memory'
import { AGENT_TYPES, EXPERTS, PIPELINES, TYPES, recallOf, similarRuns, parseCommit, parseSteps, base, branchName, commitMsg, expertName, inferType, nJ, parseCases, parseReport, tally, verifyState } from '../logic'
import { INITIAL, PANE } from '../state'
import { THEME_IDS } from '../theme'

// The session's Cockpit state (see state.ts)
export const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-25' })

export type $ = EngineInterface
type Patch = Partial<Ph> | ((s: Ph) => Partial<Ph>)

// The choices that outlast a session, a reload and a change of the state's shape: kept in the store, read at session start
const PREFS = ['focus', 'theme', 'mode', 'autoVerify', 'testAgents', 'notifyDone', 'dailyBudget', 'budgetWarned', 'chooseModel'] as const
export async function set($: $, patch: Patch) {
  let saved: Record<string, unknown> | null = null
  await update($, S, s => {
    const n = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) }
    // A token typed into the account box lives only while the box is shown (open, or no account saved yet, as the Git
    // tab draws it): once it is not, however it closed, the token is gone
    if (n.ui.ghToken && !n.ui.acctOpen && n.accounts.some(a => a.id === n.accountId)) n.ui = { ...n.ui, ghToken: '' }
    if (PREFS.some(k => n[k] !== s[k])) saved = Object.fromEntries(PREFS.map(k => [k, n[k]]))
    return n
  })
  if (!saved) return
  // Another session may have warned since this one read the settings: its warning stands over an older one here
  const was = ((await $.store.get('prefs').catch(() => undefined)) as Partial<Ph> | undefined)?.budgetWarned
  const ours = (saved as Partial<Ph>).budgetWarned
  if (was && (!ours || was.day > ours.day || (was.day === ours.day && was.budget === ours.budget && was.level === 'over'))) (saved as Partial<Ph>).budgetWarned = was
  await $.store.set('prefs', saved).catch(() => null)
}

// Cockpit's folder in the repository, kept out of git (and so out of every commit) by its own .gitignore
export async function cockpitDir($: $) {
  const root = await repoRoot($)
  if (!root) return ''
  const dir = `${root}/.cockpit`
  if (!(await $.fs.exists(`${dir}/.gitignore`).catch(() => true))) await $.fs.write(`${dir}/.gitignore`, '# Cockpit keeps its history and codebase memory here, out of git\n*\n').catch(() => null)
  return dir
}

// What a run was, without its log and brief
export const summary = (a: Agent): Agent => ({ ...a, log: [], prompt: '' })

// The repository's history: every finished flow and agent run, and Cockpit's commits, across sessions
// Session records a file holds that can be read: an id, a start, and dollars that are a real, non-negative number
function validSessions(x: unknown): SessionSpend[] {
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
  return (Array.isArray(x) ? x : []).filter((r): r is SessionSpend => !!r && typeof r.id === 'string' && ok(r.startedAt) && ok(r.endedAt) && ok(r.usd) && ok(r.tokens) && ok(r.turns))
}

export async function saveHistory($: $) {
  const dir = await cockpitDir($)
  if (!dir) return
  const s = await read($, S)
  const flows = [...s.past, ...s.flows.filter(f => f.status !== 'running')]
  const agents = [...s.pastAgents, ...s.agents.filter(a => a.status !== 'running').map(summary)]
  const dedupe = <T extends { id: string }>(xs: T[]) => [...new Map(xs.map(x => [x.id, x])).values()]
  const now = await $.clock.now()
  // This session's spend, kept in place under its start beside the earlier ones; the file is read again first, so
  // another session working in this repository at the same time keeps the records it wrote meanwhile
  const onDisk = await $.fs.read(`${dir}/history.json`).then(t => validSessions((JSON.parse(String(t)) as { sessions?: unknown }).sessions)).catch(() => [] as SessionSpend[])
  const known = onDisk.reduce((acc, x) => upsertSession(acc, x), s.pastSessions ?? [])
  const mine = s.sessionAt ? `s${s.sessionAt}` : ''
  const sessions = mine ? upsertSession(known.filter(x => x.id !== mine), { id: mine, startedAt: s.sessionAt!, endedAt: now, usd: Math.max(0, Number.isFinite(s.cost) ? s.cost : 0), tokens: s.ctx.used, turns: s.flows.length }) : known
  const data = { version: 1, savedAt: now, flows: dedupe(flows).slice(-200), agents: dedupe(agents).slice(-100), commits: s.commits.slice(0, 50), sessions }
  await $.fs.write(`${dir}/history.json`, JSON.stringify(data, null, 1)).catch(() => null)
  // What other sessions wrote meanwhile shows here too
  await set($, { pastSessions: sessions.filter(x => x.id !== mine) })
}

export async function loadHistory($: $) {
  const dir = await cockpitDir($)
  if (!dir) return
  const text = await $.fs.read(`${dir}/history.json`).catch(() => '')
  if (!text) return
  try {
    const d = JSON.parse(text) as { flows?: Flow[]; agents?: Agent[]; commits?: Commit[]; sessions?: SessionSpend[] }
    await set($, s => ({
      past: (d.flows ?? []).filter(f => !s.flows.some(x => x.id === f.id)),
      pastAgents: (d.agents ?? []).filter(a => !s.agents.some(x => x.id === a.id)),
      commits: [...s.commits, ...(d.commits ?? []).filter(c => !s.commits.some(x => x.sha === c.sha))].slice(0, 50),
      // Earlier sessions' spend; this one's own record is rewritten from the live figures at each save
      pastSessions: validSessions(d.sessions),
    }))
  } catch {
    // A history file that does not parse is left as it is and read as empty
  }
}

export async function loadPrefs($: $) {
  const p = (await $.store.get('prefs').catch(() => undefined)) as Partial<Ph> | undefined
  if (!p || typeof p !== 'object') return
  // Each saved setting is taken only if it is of its kind: a store edited by hand cannot put a word where a switch goes
  const w = p.budgetWarned
  const ok: Record<(typeof PREFS)[number], (v: unknown) => boolean> = {
    theme: v => THEME_IDS.includes(v as ThemeId),
    mode: v => v === 'auto' || v === 'ask' || v === 'off',
    dailyBudget: v => typeof v === 'number' && Number.isFinite(v) && v > 0,
    budgetWarned: () => !!w && typeof w === 'object' && typeof w.day === 'string' && (w.level === 'near' || w.level === 'over'),
    focus: v => typeof v === 'boolean',
    autoVerify: v => typeof v === 'boolean',
    testAgents: v => typeof v === 'boolean',
    notifyDone: v => typeof v === 'boolean',
    chooseModel: v => typeof v === 'boolean',
  }
  const pick = Object.fromEntries(PREFS.filter(k => k in p && p[k] !== undefined && ok[k](p[k])).map(k => [k, p[k]]))
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
const roots = new Map<string, { top: string; repos: string[] }>()
const SKIP = (n: string) => n.startsWith('.') || n === 'node_modules'
// The git repos one or two levels under a folder that is not itself in one (a folder with a .git directory or file)
// ponytail: two levels and 20 repos; deeper layouts pick by hand or open the session in the repo
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
export async function repoRoot($: $) {
  const cwd = await $.session.cwd().catch(() => '')
  let k = roots.get(cwd)
  if (k === undefined) {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel']).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }))
    const inRepo = r.exitCode === 0 && /^([A-Za-z]:)?[\\/]/.test(r.stdout.trim())
    k = { top: inRepo ? r.stdout.trim() : cwd, repos: inRepo || !cwd ? [] : await findRepos($, cwd) }
    roots.set(cwd, k)
  }
  if (!k.repos.length) return k.top
  const s = await read($, S)
  if (s.repoDir && k.repos.includes(s.repoDir)) return s.repoDir
  const saved = await $.store.get(`repo:${cwd}`).catch(() => undefined)
  const dir = k.repos.find(d => d === saved) ?? k.repos[0] ?? cwd
  await set($, st => ({ repoDir: dir, repos: k.repos.map(d => st.repos.find(r => r.dir === d) ?? { dir: d, name: d.slice(cwd.length + 1), branch: '', changed: 0 }) }))
  return dir
}

export async function git($: $, args: string[]) {
  const cwd = await repoRoot($)
  return $.process.run(['git', ...args], cwd ? { cwd } : {}).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
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

// Slow work from a press (a push, a model call, a compaction): Claude Code gives a press 10 s, and a press that waits
// past it is dropped, so the work runs on after the press returns. One of each kind at a time, and a second press says
// it is still running; the pane's header names what runs, and a failure says why.
// The lock is the state's `busy`, claimed in one update: every module reads the same state, while a module-level
// variable can be a separate copy in each module that imports this one
export async function claim($: $, kind: string, label: string) {
  let won = false
  await update($, S, s => (s.busy?.[kind] ? s : ((won = true), { ...s, busy: { ...s.busy, [kind]: label } })))
  return won
}
export async function release($: $, kind: string) {
  await set($, st => {
    const { [kind]: _, ...rest } = st.busy ?? {}
    return { busy: rest }
  }).catch(() => null)
}
export function inBackground($: $, kind: string, label: string, work: () => Promise<unknown>) {
  void (async () => {
    if (!(await claim($, kind, label).catch(() => false))) return toast($, `${label}: still running`).catch(() => null)
    try {
      await work()
    } catch (e) {
      await toast($, `${label} failed: ${String((e as Error)?.message ?? e)}`).catch(() => null)
    } finally {
      await release($, kind)
    }
  })()
}
