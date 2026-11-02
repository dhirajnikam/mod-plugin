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
import type { $, UI, V } from './shared'
import { sp, Bar, Tracker, Segs, pad, cut, Seg, Check, Rule, kindColor, Head, MapText, Card, seatDots } from './shared'

export function Header($: $, v: V) {
  const { Box, Button, Select, Text } = v.ui
  const { s, t, w } = v
  const run = s.waiting ? 'Paused · needs you' : s.isWorking ? `Running · ${fmt(v.now - s.turnStart)}` : s.turnStart ? 'Finished' : 'Idle'
  const busy = Object.values(s.busy ?? {})
  // One line: the brand and where you are on the left; what is happening and the controls on the right. It wraps,
  // rather than clips, when a pane is too narrow for it
  return (
    <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)} alignItems="center" marginBottom={v.desk ? 'sm' : 0}>
      <Box gap={sp(v, 1)} flexShrink={1} alignItems="center">
        <Text color={t.accent} bold size="heading">Cockpit</Text>
        {v.root !== '' && <Text color={t.faint} size="footnote" wrap="truncate-start">{v.root.replace(/\\/g, '/').replace(/^.*\/(?=[^/]+$)/, '')}</Text>}
      </Box>
      <Box gap={sp(v, 1)} flexWrap="wrap" alignItems="center">
        {/* Slow work a press started, running on after it: "⟳ Pushing" */}
        {busy.length > 0 && <Text color={t.busy}>{`⟳ ${busy.join(' · ')}`}</Text>}
        {s.repo.isRepo && <Text color={t.accent}>{`⎇ ${s.repo.current}`}</Text>}
        <Text color={t.dim}>{s.mode === 'auto' ? 'Auto · judge' : s.mode === 'ask' ? 'Ask · advice' : 'Judges off'}</Text>
        {v.desk ? (
          <Select key="theme" value={s.theme} options={THEME_IDS.map(id => ({ value: id, label: id === 'auto' ? '◐ auto' : `● ${id}` }))} onSelect={val => setTheme($, val as ThemeId)} />
        ) : (
          THEME_IDS.map(id => (
            <Button key={`theme-${id}`} plain onPress={() => setTheme($, id as ThemeId)}>
              {id === 'auto' ? (
                <Text color={id === s.theme ? t.accent : t.dim}>{id === s.theme ? '[◐ auto]' : '◐'}</Text>
              ) : (
                <Text color={THEMES[id].accent} backgroundColor={THEMES[id].bg}>{id === s.theme ? '◉' : '●'}</Text>
              )}
            </Button>
          ))
        )}
        <Text backgroundColor={s.waiting ? t.busy : s.isWorking ? t.accent : t.text} color={t.bg || 'inverseText'}>{` ${run} `}</Text>
      </Box>
    </Box>
  )
}

export function Tabs($: $, v: V) {
  const { Box, Button, Text } = v.ui
  const { s, t } = v
  const vs = verifyState(s.agents)
  const running = s.agents.filter(a => a.status === 'running').length
  const all: [Tab, string, string][] = [
    ['overview', 'Overview', s.waiting ? '!' : ''],
    ['files', 'Activity', s.ops.length ? String(s.ops.length) : ''],
    ['agents', 'Agents', running ? String(running) : vs.fail ? `✗${vs.fail}` : ''],
    ['git', 'Git', s.repo.changed.length ? String(s.repo.changed.length) : ''],
    ['rules', 'Rules', ''],
  ]
  // Split into cockpit-core and its add-ons, the tabs of the add-ons installed; with none, how to add one
  const tabs = s.tabsAvailable ? all.filter(([id]) => s.tabsAvailable?.includes(id)) : all
  if (!tabs.length) {
    return (
      <Box flexDirection="column">
        <Rule v={v} />
        <Text color={t.dim} wrap="wrap">No tabs yet: install cockpit-overview, cockpit-activity, cockpit-agents, cockpit-git or cockpit-rules, and its tab shows here.</Text>
      </Box>
    )
  }
  // The underline follows the tab row: each tab's width, and the one-cell gap between tabs
  const total = tabs.reduce((a, [, l, b]) => a + l.length + (b ? b.length + 2 : 0) + 2, 0) + tabs.length - 1
  const fits = total <= v.w
  const under = tabs.map(([id, label, badge], i) => {
    const n = label.length + (badge ? badge.length + 2 : 0) + 2
    return (
      <Text key={`u-${id}`} color={id === s.tab ? t.accent : t.divider}>
        {(id === s.tab ? '━' : '─').repeat(n)}
        {i < tabs.length - 1 && <Text color={t.divider}>─</Text>}
      </Text>
    )
  })
  return (
    <Box flexDirection="column">
      <Box flexWrap="wrap" columnGap={sp(v, 1)} rowGap={v.desk ? 'xs' : 0}>
        {tabs.map(([id, label, badge]) => {
          const open = () => Promise.all([set($, { tab: id }), id === 'git' ? refreshRepo($) : id === 'agents' ? discoverAgentTypes($) : id === 'files' ? loadProject($) : id === 'rules' ? loadRules($) : null])
          return v.desk ? (
            <Button key={`tab-${id}`} label={badge ? `${label} ${badge}` : label} variant={id === s.tab ? 'primary' : 'secondary'} onPress={open} />
          ) : (
            <Button key={`tab-${id}`} plain onPress={open}>
              <Text color={id === s.tab ? t.text : t.dim} bold={id === s.tab} backgroundColor={!fits && id === s.tab ? t.wash || undefined : undefined}>{` ${label}`}</Text>
              {badge ? <Text backgroundColor={t.wash || undefined} color={t.deep}>{` ${badge} `}</Text> : <Text> </Text>}
              {badge ? <Text> </Text> : <Text />}
            </Button>
          )
        })}
      </Box>
      {fits && !v.desk ? (
        <Text mono>
          {under}
          <Text color={t.divider}>{'─'.repeat(v.w - total)}</Text>
        </Text>
      ) : (
        <Rule v={v} />
      )}
    </Box>
  )
}
