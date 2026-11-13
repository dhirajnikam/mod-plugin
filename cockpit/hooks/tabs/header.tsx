
import type { Tab, ThemeId } from '../../types'
import {
  discoverAgentTypes,
  loadProject,
  refreshGit,
  set,
  setTheme,
} from '../actions'
import {
  verifyState,
  fmt,
} from '../logic'
import { loadRules } from '../actions'
import { THEMES, THEME_IDS } from '../theme'
import type { $, V } from './shared'
import { sp, Rule } from './shared'

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
        {s.repo.isRepo && <Text color={t.accent} wrap="truncate-end">{`⎇ ${s.repo.current}`}</Text>}
        <Text color={t.dim}>{s.mode === 'auto' ? 'Auto · judge' : s.mode === 'ask' ? 'Ask · advice' : 'Judges off'}</Text>
        {v.desk ? (
          <Select key="theme" value={s.theme} options={THEME_IDS.map(id => ({ value: id, label: id === 'auto' ? '◐ auto' : `● ${id}` }))} onSelect={val => setTheme($, val as ThemeId)} />
        ) : (
          // One mark for the theme in use, a press stepping to the next, so the header keeps to one line in a narrow pane
          <Button key="theme" plain onPress={() => setTheme($, THEME_IDS[(THEME_IDS.indexOf(s.theme) + 1) % THEME_IDS.length] as ThemeId)}>
            {s.theme === 'auto' ? <Text color={t.dim}>◐</Text> : <Text color={THEMES[s.theme].accent} backgroundColor={THEMES[s.theme].bg}>●</Text>}
          </Button>
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
  // The tabs an add-on said it draws (tabsAvailable); absent, every tab
  const tabs = s.tabsAvailable ? all.filter(([id]) => s.tabsAvailable?.includes(id)) : all
  // The underline follows the tab row: each tab's width, and the one-cell gap between tabs. A pane too narrow for the
  // padded tabs draws them tight, without the space around each name, before it lets the row wrap
  const widthOf = (label: string, badge: string, tight: boolean) => (tight ? label.length + (badge ? badge.length + 1 : 0) : label.length + (badge ? badge.length + 2 : 0) + 2)
  const totalOf = (tight: boolean) => tabs.reduce((a, [, l, b]) => a + widthOf(l, b, tight), 0) + tabs.length - 1
  const tight = totalOf(false) > v.w
  const total = totalOf(tight)
  const fits = total <= v.w
  const under = tabs.map(([id, label, badge], i) => {
    const n = widthOf(label, badge, tight)
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
          const open = () => Promise.all([set($, { tab: id }), id === 'git' ? refreshGit($) : id === 'agents' ? discoverAgentTypes($) : id === 'files' ? loadProject($) : id === 'rules' ? loadRules($) : null])
          return v.desk ? (
            <Button key={`tab-${id}`} label={badge ? `${label} ${badge}` : label} variant={id === s.tab ? 'primary' : 'secondary'} onPress={open} />
          ) : (
            <Button key={`tab-${id}`} plain onPress={open}>
              <Text color={id === s.tab ? t.text : t.dim} bold={id === s.tab} backgroundColor={!fits && id === s.tab ? t.wash || undefined : undefined}>{tight ? label : ` ${label}`}</Text>
              {badge ? <Text backgroundColor={t.wash || undefined} color={t.deep}>{tight ? ` ${badge}` : ` ${badge} `}</Text> : <Text>{tight ? '' : ' '}</Text>}
              {badge && !tight ? <Text> </Text> : <Text />}
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
