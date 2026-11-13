import type { ElementTable, EngineInterface, RenderNode } from 'claude-code'

import type { Agent, Decision, Ph } from '../../types'
import {
  stepWords,
  planProgress,
  tally,
} from '../logic'
import { featureMapText } from '../memory'
import type { FeatureMark, MapTone } from '../memory'
import type { Theme } from '../theme'

export type $ = EngineInterface
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

// A thin bar: filled share in one colour, the rest as track
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

// One agent's tracker: its task list as a bar with done of all and the task it is on; without a list, its current step
export function Tracker({ v, a }: { v: V; a: Agent }) {
  const { Box, Text } = v.ui
  const { t } = v
  const pp = planProgress(a.plan)
  const step = stepWords(a.log[a.log.length - 1]?.t)
  if (!pp.total) return <Text color={t.busy} size="footnote" wrap="truncate-end">{step}</Text>
  return (
    <Box columnGap={v.desk ? 'sm' : 1} alignItems="center">
      <Bar ui={v.ui} w={10} frac={pp.done / pp.total} fill={t.ok} track={t.track} />
      <Text size="footnote" wrap="truncate-end">
        <Text color={t.dim}>{`${pp.done}/${pp.total}  `}</Text>
        <Text color={t.busy}>{pp.now || step}</Text>
      </Text>
    </Box>
  )
}

// Several shares side by side in one bar, track after them
export function Segs({ ui, w, parts, track }: { ui: UI; w: number; parts: [number, string][]; track: string }) {
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

export const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, Math.max(1, n)) : s + ' '.repeat(n - s.length))
export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

// A row of choices drawn as one segmented control
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

// A change's kind in its status colour: new, deleted, renamed, edited
export const kindColor = (t: Theme, meta: string) => (meta === 'new' ? t.ok : meta === 'deleted' ? t.bad : meta.startsWith('renamed') ? t.busy : t.hi)

// A section's heading, as every tab draws it: small capitals, a dim count, a colour of its own when it warns
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

// A map where no SVG is drawn (the terminal): its boxes and arrows in characters (featureMapText)
export function MapText({ v, nodes, marks }: { v: V; nodes: { name: string; uses: string[]; files?: string[] }[]; marks: Record<string, FeatureMark> }) {
  const { Box, Text } = v.ui
  const { t } = v
  const color: Record<MapTone, string> = { line: t.faint, lit: t.accent, box: t.faint, name: t.dim, 'name-now': t.text, 'name-marked': t.text, note: t.faint, now: t.busy, touched: t.accent, reached: t.busy }
  return (
    <Box flexDirection="column">
      {featureMapText(nodes, marks, v.w).map((line, i) => (
        <Text key={`ml-${i}`} wrap="truncate-end">
          {line.length ? line.map((r, j) => <Text key={`mr-${j}`} color={color[r.tone]} bold={r.tone === 'name-now'}>{r.text}</Text>) : ' '}
        </Text>
      ))}
    </Box>
  )
}

// A card in the chat, as the design draws tool activity: icon, text, figures on the right
// tone: the colour of the right-hand words, by what they say (a pass, a failure, work still running)
export function Card({ ui, t, w, id, dashed, icon, left, right, onPress, tone }: { ui: UI; t: Theme; w: number; id: string; dashed: boolean; icon: string; left: RenderNode | RenderNode[]; right: string; onPress: () => unknown; tone?: string }) {
  const { Box, Button, Text } = ui
  return (
    <Box borderStyle={dashed ? 'dashed' : 'round'} borderColor={t.lo} paddingX={1} marginTop="md" width={w} justifyContent="space-between" columnGap={2}>
      <Box flexShrink={1}>
        <Text color={t.hi}>{`${icon} `}</Text>
        <Button key={`card-${id}`} plain onPress={onPress}>
          {left}
        </Button>
      </Box>
      <Box flexShrink={0}>
        <Text color={tone ?? t.hi}>{right}</Text>
      </Box>
    </Box>
  )
}

// Seats as dots: filled for the winning option, hollow for the rest, faint while voting
export function seatDots(ui: UI, t: Theme, d: Decision) {
  const { Text } = ui
  const top = tally(d).top
  return d.votes.map((v, i) => (
    <Text key={`dot-${d.id}-${i}`} color={v < 0 ? t.faint : v === top ? t.ok : t.dim}>{v < 0 || v !== top ? '○' : '●'}</Text>
  ))
}
