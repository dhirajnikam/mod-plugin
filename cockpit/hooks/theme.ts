import type { Palette, ThemeId } from '../types'

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
}

export const THEMES: Record<Palette, Theme> = {
  paper: { bg: '#f3f2f2', surface: '#ebe9e6', text: '#1d1b18', dim: '#6f6a63', faint: '#a29d96', track: '#dcd8d2', divider: '#cfcac3', accent: '#b68235', hi: '#8a5e1e', deep: '#5c3d10', lo: '#e2c08c', wash: '#f6e8d2' },
  white: { bg: '#ffffff', surface: '#f6f6f6', text: '#111111', dim: '#737373', faint: '#b8b8b8', track: '#e9e9e9', divider: '#d6d6d6', accent: '#9a6a22', hi: '#7a5214', deep: '#573a0c', lo: '#e6c28a', wash: '#fbf1e2' },
  black: { bg: '#0b0b0b', surface: '#131313', text: '#e8e6e3', dim: '#929292', faint: '#4a4a4a', track: '#232323', divider: '#323232', accent: '#d4a35a', hi: '#e3bd80', deep: '#efd3a6', lo: '#6b4e22', wash: '#2a1f10' },
  solarized: { bg: '#002b36', surface: '#04313d', text: '#eee8d5', dim: '#839496', faint: '#3b6470', track: '#0d3f4c', divider: '#1c4f5b', accent: '#b58900', hi: '#d9b03a', deep: '#ebcc6a', lo: '#6a5a10', wash: '#1d3b2c' },
  nord: { bg: '#2e3440', surface: '#333a47', text: '#eceff4', dim: '#8a94a8', faint: '#4c566a', track: '#3b4252', divider: '#434c5e', accent: '#88c0d0', hi: '#a8d4e0', deep: '#c6e3eb', lo: '#4a6f80', wash: '#2f4150' },
}

export const THEME_IDS: ThemeId[] = ['auto', ...(Object.keys(THEMES) as Palette[])]

// The palette in force: Auto picks White or Black from Claude Code's theme
export const themeOf = (s: { theme: ThemeId; isDarkTerm: boolean }): Theme =>
  THEMES[s.theme === 'auto' ? (s.isDarkTerm ? 'black' : 'white') : s.theme]

// Context legend shades, darkest first, as the design ramps the accent
export const ctxShades = (t: Theme) => [t.deep, t.accent, t.lo, t.faint]

