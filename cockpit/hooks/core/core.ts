import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Ph, ThemeId } from '../../types'
import { isWarned, standingWarning } from './spend'
import { INITIAL, PANE } from './state'
import { THEME_IDS } from './theme'
import { MODES, modeOf } from './modes'


// The session's Cockpit state. The engine reads an atom only in the file that declares it, so this is the one place:
// everything else reads through look() and writes through set(). Bump the tag when Ph's fields change, so an older
// stored value reads as INITIAL.
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-26' })

export type $ = EngineInterface
export function look($: $) {
  return read($, S)
}
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
  const prefs: Partial<Ph> = saved
  prefs.budgetWarned = standingWarning((await storedPrefs($))?.budgetWarned, prefs.budgetWarned)
  // Bookkeeping in the background: a failed save must not fail the turn that changed the setting
  await $.store.set('prefs', saved).catch(() => null)
}

// What the pane has open, typed or folded: one field or several, the rest kept
export function setUi($: $, patch: Partial<Ph['ui']> | ((ui: Ph['ui']) => Partial<Ph['ui']>)) {
  return set($, s => ({ ui: { ...s.ui, ...(typeof patch === 'function' ? patch(s.ui) : patch) } }))
}

// The saved preferences as the store holds them right now; none where there are none, or the store cannot be read
export async function storedPrefs($: $) {
  return (await $.store.get('prefs').catch(() => undefined)) as Partial<Ph> | undefined
}

// Each setting is taken only if it is of its kind: a store edited by hand cannot put a word where a switch goes
const ok: Record<(typeof PREFS)[number], (v: unknown) => boolean> = {
  theme: v => THEME_IDS.includes(v as ThemeId),
  mode: v => MODES.some(m => m.id === v),
  dailyBudget: v => typeof v === 'number' && Number.isFinite(v) && v > 0,
  budgetWarned: isWarned,
  focus: v => typeof v === 'boolean',
  autoVerify: v => typeof v === 'boolean',
  testAgents: v => typeof v === 'boolean',
  notifyDone: v => typeof v === 'boolean',
  chooseModel: v => typeof v === 'boolean',
}

export async function loadPrefs($: $) {
  const p = await storedPrefs($)
  if (!p || typeof p !== 'object') return
  const pick = Object.fromEntries(PREFS.filter(k => k in p && p[k] !== undefined && ok[k](p[k])).map(k => [k, p[k]]))
  await update($, S, s => ({ ...s, ...pick }))
}

// The choices the install screen and /config set (plugin.json's userConfig). Each applies when it differs from the one
// applied last, so a later /cockpit theme or mode stands until /config changes that same field. An upgrade (settings
// saved, no options applied yet) keeps its settings; a first run takes them all and says where to change them
const OPTIONS = ['theme', 'mode', 'testAgents', 'autoVerify', 'notifyDone', 'dailyBudget'] as const
export async function applyOptions($: $, options: Readonly<Record<string, unknown>>) {
  const last = (await $.store.get('appliedOptions').catch(() => undefined)) as Record<string, unknown> | undefined
  const given = Object.fromEntries(OPTIONS.filter(k => k in options).map(k => [k, options[k]]))
  const saved = await storedPrefs($)
  if (!last && saved) return void (await $.store.set('appliedOptions', given).catch(() => null))
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(given)) {
    if (last && last[k] === v) continue
    // A budget of 0 is none
    if (k === 'dailyBudget' && v === 0) patch[k] = undefined
    else if (ok[k as (typeof OPTIONS)[number]](v)) patch[k] = v
  }
  if (Object.keys(patch).length) await set($, patch as Partial<Ph>)
  await $.store.set('appliedOptions', given).catch(() => null)
  const s = await look($)
  if (!last) await note($, `Cockpit is set up: theme ${s.theme}, judges ${modeOf(s.mode).label}. Change these in /config, or with /cockpit theme and /cockpit mode; /cockpit opens the pane.`)
}

export async function toast($: $, text: string) {
  $.ui.toast(`◆ ${text}`)
}

// A line in the chat for work Cockpit ran itself (no tool row exists for it); the model never reads it. A line that
// cannot be written is dropped: it must never fail the work it reports
export async function note($: $, text: string) {
  await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } }).catch(() => null)
}

// Whether the pane has a place on screen
export async function paneShown($: $) {
  return (await $.ui.panes().catch(() => [])).some(p => p.id === PANE && p.isPlaced)
}

export async function openPane($: $) {
  return $.ui.open({ id: PANE, title: 'Cockpit' })
}

// The terminal's background, for the Auto theme: COLORFGBG where the terminal sets it ("15;0": the last number is the
// background, 0-6 and 8 dark), else the system's appearance on a Mac right now (a terminal profile that follows it, as
// Terminal's Basic does, switches with it; Claude Code's own 'auto' keeps the one it started with). Neither: unknown
// ponytail: a Terminal profile with a fixed background of its own is not read; COLORFGBG or a named theme covers it
export async function readTermBg($: $) {
  const run = (argv: string[]) => $.process.run(argv).catch(() => null)
  let bg: 'dark' | 'light' | undefined
  const fgbg = (await run(['printenv', 'COLORFGBG']))?.stdout.trim() ?? ''
  const n = Number(fgbg.split(';').pop())
  if (fgbg && Number.isInteger(n)) bg = n < 7 || n === 8 ? 'dark' : 'light'
  else {
    const r = await run(['defaults', 'read', '-g', 'AppleInterfaceStyle'])
    // "Dark", or no such key (the system is light); any other answer (not a Mac) says nothing
    if (r?.exitCode === 0 && /^\s*dark/i.test(r.stdout)) bg = 'dark'
    else if (r && r.exitCode !== 0 && /does not exist/i.test(r.stderr ?? '')) bg = 'light'
  }
  if ((await look($)).termBg !== bg) await set($, { termBg: bg })
}

export async function setTheme($: $, theme: ThemeId) {
  await set($, { theme })
  await openPane($)
  await toast($, `Theme: ${theme}`)
}

// Slow work from a press (a push, a model call, a compaction): Claude Code gives a press 10 s, and a press that waits
// past it is dropped, so the work runs on after the press returns. One of each kind at a time, and a second press says
// it is still running; the pane's header names what runs, and a failure says why.
// The lock is the state's `busy`, claimed in one update: it lives in the state so the pane's header can draw what runs.
// A release that fails leaves the lock held until the next session start resets `busy`
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

// Your home folder, '' where the environment names none
export async function homeDir($: $) {
  return (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
}

// A prompt Cockpit sends to Claude without waiting for its turn. From inside a hook that holds the turn (a command, a
// turn's end) the engine refuses the submit by throwing, so it goes once more from a timer after that hook has
// returned. A prompt the engine drops is tried once more the same way; one that cannot go the second time has failed
export function submitPrompt($: $, text: string, failed: () => unknown) {
  const send = async (onDrop: () => unknown) => {
    const r = await $.prompt.submit({ text })
    if ('drop' in r && r.drop) await onDrop()
  }
  const again = () => {
    try {
      $.clock.after(20, () => void send(failed).catch(failed))
    } catch {
      void failed()
    }
  }
  void send(again).catch(again)
}
