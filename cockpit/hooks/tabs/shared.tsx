import type { ElementTable, EngineInterface, RenderNode } from 'claude-code'

import type { Account, Agent, Decision, GitForm, Ph, Tab, ThemeId } from '../../types'
import {
  applyAccount,
  commit,
  confirmPending,
  createAgent,
  buildMemory,
  discoverAgentTypes,
  loadProject,
  runExpert,
  ghLoginToken,
  ghLoginWeb,
  planCommit,
  pushNow,
  pullNow,
  showCommit,
  skipPending,
  suggestCommit,
  gitInit,
  loadAccounts,
  removeAccount,
  useAccount,
  refreshRepo,
  set,
  startPipeline,
  setTheme,
  spawnAgent,
  stopAgent,
  rerun,
  compactNow,
  clearNow,
  runMany,
  stopAll,
  clearFinished,
  testAgent,
  TESTERS,
} from '../actions'
import {
  AGENT_TYPES,
  stepWords,
  planProgress,
  similarRuns,
  recallOf,
  neuralSvg,
  graphRows,
  graphSvg,
  graphText,
  agentIconSvg,
  AUTO_WHENS,
  BRANCH_PRESETS,
  COMMIT_MODES,
  EXPERTS,
  PIPELINES,
  FLOWS,
  progressOf,
  expertGlyph,
  expertName,
  verifyState,
  GIT_OPTS,
  MSG_PRESETS,
  TYPES,
  branchName,
  commitMsg,
  fmt,
  kTok,
  progress,
  ringRuns,
  ringSvg,
  tally,
  thrOf,
  tree,
} from '../logic'
import type { IconState, Neuron } from '../logic'
import { featureLayers, featureMapSvg, features as featureList, impactOf, isTestFeature, memberOf, memoryKey } from '../memory'
import type { FeatureMark } from '../memory'
import { loadRules, pickFlow, resumeAutopilot, setGit as setGitPref, startAutopilot, stopAutopilot, writeInstructions, writeSettings } from '../actions'
import { HOOK_EVENTS, PERM_KINDS, changeHook, changePerm, changeRule, hookRows, parseSettings, permRows, ruleLines } from '../rules'
import type { PermKind } from '../rules'
import { THEMES, THEME_IDS, ctxShades } from '../theme'
import type { Theme } from '../theme'

export type $ = EngineInterface
type T = ElementTable<'terminal'>
export type UI = Pick<T, 'Box' | 'Text' | 'Button' | 'Input' | 'Select'> & { Svg?: ElementTable<'desktop'>['Svg'] }
// Spacing: cells on the terminal, the surface's own steps on a graphical one
export const sp = (v: V, n: number) => (v.desk ? (n >= 3 ? 'lg' : n === 2 ? 'md' : 'sm') : n)

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

// A map where no SVG is drawn (the terminal): its layers as indented lines, each node with what it points to
export function MapText({ v, nodes, marks }: { v: V; nodes: { name: string; uses: string[] }[]; marks: Record<string, FeatureMark> }) {
  const { Box, Text } = v.ui
  const { t } = v
  return (
    <Box flexDirection="column">
      {featureLayers(nodes.map(n => ({ ...n, what: '', files: [], usedBy: [] }))).map((layer, i) => (
        <Box key={`ml-${i}`} flexDirection="column">
          {layer.map(n => {
            const f = nodes.find(x => x.name === n)!
            const m = marks[n]
            const uses = f.uses.filter(u => nodes.some(x => x.name === u))
            return (
              <Text key={`mn-${n}`} wrap="truncate-end">
                <Text color={t.faint}>{'  '.repeat(i)}</Text>
                <Text color={m === 'now' ? t.busy : m === 'touched' ? t.accent : m === 'reached' ? t.busy : t.faint}>{m === 'now' ? '■ ' : m === 'touched' ? '◆ ' : m === 'reached' ? '◇ ' : '· '}</Text>
                <Text color={m ? t.text : t.dim} bold={m === 'now'}>{n}</Text>
                {uses.length > 0 && <Text color={t.faint}>{` → ${uses.join(', ')}`}</Text>}
              </Text>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

// A card in the chat, as the design draws tool activity: icon, text, figures on the right
export function Card({ ui, t, w, id, dashed, icon, left, right, onPress }: { ui: UI; t: Theme; w: number; id: string; dashed: boolean; icon: string; left: RenderNode | RenderNode[]; right: string; onPress: () => unknown }) {
  const { Box, Button, Text } = ui
  return (
    <Box borderStyle={dashed ? 'dashed' : 'round'} borderColor={t.lo} paddingX={1} width={w} justifyContent="space-between" columnGap={2}>
      <Box>
        <Text color={t.hi}>{`${icon} `}</Text>
        <Button key={`card-${id}`} plain onPress={onPress}>
          {left}
        </Button>
      </Box>
      <Text color={t.hi}>{right}</Text>
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
