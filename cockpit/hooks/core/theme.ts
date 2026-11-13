import type { Palette, ThemeId } from '../../types'

// The design's five themes, reduced to the tokens a terminal draws with
export type Theme = {
  bg: string
  surface: string
  text: string
  dim: string
  faint: string
  track: string
  divider: string
  accent: string
  hi: string
  deep: string
  lo: string
  wash: string
  // Status colours: done, failed, busy; a palette's own, made to read on its background
  ok: string
  bad: string
  busy: string
}

export const THEMES: Record<Palette, Theme> = {
  paper: { bg: '#f3f2f2', surface: '#ebe9e6', text: '#1d1b18', dim: '#6f6a63', faint: '#a29d96', track: '#dcd8d2', divider: '#cfcac3', accent: '#b68235', hi: '#8a5e1e', deep: '#5c3d10', lo: '#e2c08c', wash: '#f6e8d2', ok: '#2e7d4f', bad: '#c0392b', busy: '#a86400' },
  white: { bg: '#ffffff', surface: '#f6f6f6', text: '#111111', dim: '#737373', faint: '#b8b8b8', track: '#e9e9e9', divider: '#d6d6d6', accent: '#9a6a22', hi: '#7a5214', deep: '#573a0c', lo: '#e6c28a', wash: '#fbf1e2', ok: '#237a46', bad: '#c0392b', busy: '#a35f00' },
  black: { bg: '#0b0b0b', surface: '#131313', text: '#e8e6e3', dim: '#929292', faint: '#4a4a4a', track: '#232323', divider: '#323232', accent: '#d4a35a', hi: '#e3bd80', deep: '#efd3a6', lo: '#6b4e22', wash: '#2a1f10', ok: '#5cc98a', bad: '#ef6b6b', busy: '#e6b450' },
  solarized: { bg: '#002b36', surface: '#04313d', text: '#eee8d5', dim: '#839496', faint: '#3b6470', track: '#0d3f4c', divider: '#1c4f5b', accent: '#b58900', hi: '#d9b03a', deep: '#ebcc6a', lo: '#6a5a10', wash: '#1d3b2c', ok: '#859900', bad: '#dc322f', busy: '#cb4b16' },
  nord: { bg: '#2e3440', surface: '#333a47', text: '#eceff4', dim: '#8a94a8', faint: '#4c566a', track: '#3b4252', divider: '#434c5e', accent: '#88c0d0', hi: '#a8d4e0', deep: '#c6e3eb', lo: '#4a6f80', wash: '#2f4150', ok: '#a3be8c', bad: '#bf616a', busy: '#ebcb8b' },
}

export const THEME_IDS: ThemeId[] = ['auto', ...(Object.keys(THEMES) as Palette[])]

// Auto: Claude Code's own theme keys, which follow the person's light or dark theme on every surface
// (the desktop's appearance is not readable from a setting), and a mid-tone gold that reads on both. No wash: a chip
// sits on the surface's own background (gold on its grey 'inactive' read at 1–2:1)
export const AUTO: Theme = { bg: '', surface: '', text: 'text', dim: 'subtle', faint: 'inactive', track: 'inactive', divider: 'inactive', accent: '#b4833a', hi: '#c4934c', deep: '#a07a3c', lo: '#cfa159', wash: '', ok: 'success', bad: 'error', busy: 'warning' }

export const themeOf = (s: { theme: ThemeId }): Theme => (s.theme === 'auto' ? AUTO : THEMES[s.theme] ?? AUTO)

// The chat's rows (spinner, cards, your messages, the status line) sit on the terminal's own background, which a palette
// does not paint: they keep the surface's own text colours and take only the palette's accent, so White on a dark
// terminal, or Black on a light one, never draws text the background hides
export const chatThemeOf = (s: { theme: ThemeId }): Theme => (s.theme === 'auto' ? AUTO : { ...AUTO, accent: THEMES[s.theme]?.accent ?? AUTO.accent })

// An SVG reads only real colours: a theme key (Auto's "text", "inactive") becomes the tone given for it, one that reads
// on light and dark
export function realColors<T extends Record<string, string>>(c: T, tones: { [K in keyof T]: string }): T {
  const out: Record<string, string> = {}
  for (const k of Object.keys(c)) out[k] = /^(#|rgb|hsl)/.test(c[k]!) ? c[k]! : tones[k]!
  return out as T
}
// The surface a drawing sits on when the theme names no real colour for it: a dark terminal's
export const DARK_SURFACE = '#262624'
// The tones the SVG drawings share; each drawing adds the ones only it has
export const SVG_TONES = { accent: AUTO.accent, busy: '#d9a441', text: '#d6d3ce', dim: '#8a8a8a', track: 'rgba(128,128,128,0.35)' }

// How full the context window is: calm below half, busy from 50 %, bad from 80 %, when Claude Code is about to compact it
export const ctxLevel = (pct: number) => (pct >= 80 ? 'bad' : pct >= 50 ? 'busy' : 'ok')
// The colour its fill is written in: the theme's own for busy and bad; a calm one keeps the colour of the words around it
export const ctxColor = (t: Theme, pct: number, calm: string) => {
  const level = ctxLevel(pct)
  return level === 'ok' ? calm : t[level]
}

// Context legend shades, darkest first, as the design ramps the accent
export const ctxShades = (t: Theme) => [t.deep, t.accent, t.lo, t.faint]

