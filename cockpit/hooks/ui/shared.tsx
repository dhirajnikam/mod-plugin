import type { ElementTable } from 'claude-code'

import type { Ph } from '../../types'
import type { Theme } from '../core/theme'
import { DARK_SURFACE } from '../core/theme'

type T = ElementTable<'terminal'>
export type UI = Pick<T, 'Box' | 'Text' | 'Button' | 'Input' | 'Select'> & { Svg?: ElementTable<'desktop'>['Svg'] }
// Spacing: cells on the terminal, the surface's own steps on a graphical one
export const sp = (v: V, n: number) => (v.desk ? (n >= 3 ? 'lg' : n === 2 ? 'md' : 'sm') : n)

// A field's height for what it holds: a row per line and per wrap at the pane's width, up to six, so long text stays
// in view instead of scrolling sideways. The label is drawn beside the field and takes its share of the row
export const grow = (v: V, text: string | undefined, label = '', least = 1) =>
  Math.min(6, Math.max(least, (text ?? '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / Math.max(12, v.w - label.length - 8))), 0)))

// desk: a graphical surface, whose native buttons draw their label in their own colour, so coloured marks sit beside them
export type V = { ui: UI; s: Ph; t: Theme; w: number; now: number; root: string; desk: boolean }

export function Bar({ ui, w, frac, fill, track }: { ui: UI; w: number; frac: number; fill: string; track: string }) {
  const { Text } = ui
  const n = Math.max(0, Math.min(w, Math.round(frac * w)))
  return (
    <Text mono>
      <Text color={fill}>{'━'.repeat(n)}</Text>
      <Text color={track}>{'━'.repeat(w - n)}</Text>
    </Text>
  )
}

export function Segs({ ui, w, parts, track }: { ui: Pick<UI, 'Text'>; w: number; parts: [number, string][]; track: string }) {
  const { Text } = ui
  let left = w
  const cells = parts.map(([frac, c], i) => {
    const n = Math.min(left, Math.round(frac * w))
    left -= n
    return <Text key={`s${i}`} color={c}>{'━'.repeat(n)}</Text>
  })
  return (
    <Text mono>
      {cells}
      <Text color={track}>{'━'.repeat(left)}</Text>
    </Text>
  )
}

export function Seg<K extends string>({ v, id, items, value, onPick }: { v: V; id: string; items: [K, string][]; value: K; onPick: (k: K) => unknown }) {
  const { Box, Button, Text } = v.ui
  return (
    <Box flexWrap="wrap" columnGap={v.desk ? 'sm' : 0} rowGap={v.desk ? 'sm' : 0}>
      {items.map(([k, label]) =>
        v.desk ? (
          <Button key={`${id}-${k}`} label={label} variant={k === value ? 'primary' : 'secondary'} onPress={() => onPick(k)} />
        ) : (
          <Button key={`${id}-${k}`} plain onPress={() => onPick(k)}>
            <Text backgroundColor={k === value ? v.t.accent : v.t.track} color={k === value ? v.t.bg || 'inverseText' : v.t.dim} bold={k === value}>
              {` ${label} `}
            </Text>
          </Button>
        ),
      )}
    </Box>
  )
}

export function Check({ v, id, on, label, onPress }: { v: V; id: string; on: boolean; label: string; onPress: () => unknown }) {
  const { Button, Text } = v.ui
  return (
    <Button key={id} plain onPress={onPress}>
      <Text color={on ? v.t.accent : v.t.faint}>{on ? '▣ ' : '□ '}</Text>
      <Text color={v.t.text}>{label}</Text>
    </Button>
  )
}

export const Rule = ({ v }: { v: V }) => <v.ui.Text color={v.t.divider} mono>{'─'.repeat(v.w)}</v.ui.Text>

export const kindColor = (t: Theme, meta: string) => (meta === 'new' ? t.ok : meta === 'deleted' ? t.bad : meta.startsWith('renamed') ? t.busy : t.hi)

// A section's heading that does not fold, the one every tab draws: small capitals, a dim count and note, a colour of
// its own when it warns
export function Head({ v, label, n, color, note }: { v: V; label: string; n?: number; color?: string; note?: string }) {
  const { Text } = v.ui
  return (
    <Text size="footnote" bold wrap="truncate-end">
      <Text color={color ?? v.t.dim}>{label.toUpperCase()}</Text>
      {n !== undefined && <Text color={v.t.faint}>{` ${n}`}</Text>}
      {note !== undefined && <Text color={v.t.faint}>{`  ${note}`}</Text>}
    </Text>
  )
}

// A heading that folds what is under it: an arrow, small capitals, a dim count, a note in plain weight
export function Fold({ v, id, open, label, n, note, onPress }: { v: V; id: string; open: boolean; label: string; n?: number; note?: string; onPress: () => unknown }) {
  const { Button, Text } = v.ui
  const { t } = v
  return (
    <Button key={id} plain onPress={onPress}>
      <Text size="footnote" bold>
        <Text color={t.faint}>{open ? '⌄ ' : '› '}</Text>
        <Text color={t.dim}>{label.toUpperCase()}</Text>
        {n !== undefined && <Text color={t.faint}>{` ${n}`}</Text>}
        {note !== undefined && <Text color={t.faint} bold={false}>{`  ${note}`}</Text>}
      </Text>
    </Button>
  )
}

// The fold a tab keeps everything past its first screen under
export function More({ v, id, open, onPress }: { v: V; id: string; open: boolean; onPress: () => unknown }) {
  const { Button, Text } = v.ui
  return (
    <Button key={id} plain onPress={onPress}>
      <Text color={v.t.dim}>{`${open ? '⌄' : '›'} More`}</Text>
    </Button>
  )
}

// Lines added and removed, in their status colours: +12 −3
export function Diff({ ui, t, add, del, size }: { ui: Pick<UI, 'Text'>; t: Theme; add: number; del: number; size?: 'footnote' }) {
  const { Text } = ui
  return (
    <Text {...(size ? { size } : {})}>
      <Text color={t.ok}>{`+${add}`}</Text>
      <Text color={t.bad}>{` −${del}`}</Text>
    </Text>
  )
}

// What an SVG map is drawn with: the theme's colours, on the pane's surface (a terminal's own when the theme names
// none), at the pane's own width so it is drawn at full size instead of shrunk to fit
export const svgColors = (v: V) => ({ accent: v.t.accent, busy: v.t.busy, text: v.t.text, dim: v.t.dim, track: v.t.divider, bg: /^#/.test(v.t.surface) ? v.t.surface : v.s.isDarkTerm ? DARK_SURFACE : '#f5f4ef' })
export const svgWidth = (v: V) => Math.max(320, v.w * 8)
