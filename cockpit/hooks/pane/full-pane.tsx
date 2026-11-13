import type { Frozen, Register, RenderInput } from 'claude-code'
import type { $ } from '../core/core'
import { look } from '../core/core'
import { themeOf } from '../core/theme'
import { PANE } from '../core/state'
import { Header, Tabs } from './header'
import { Overview } from './overview-tab'
import { Agents } from '../agents/agents-tab'
import { Git } from '../git/git-tab'
import { Rules } from '../rules/rules-tab'
import { Files } from '../memory/activity-tab'
import type { V, UI } from '../ui/shared'

// What the pane's views draw with; null on a surface with no fields
async function paneV($: $, e: Frozen<RenderInput<'Pane'>>, root: string): Promise<V | null> {
  const table = $.ui.resolve(e)
  if (!('Input' in table) || !('Select' in table)) return null
  const s = await look($)
  const ui: UI = { Box: table.Box, Text: table.Text, Button: table.Button, Input: table.Input, Select: table.Select, ...('Svg' in table && e.surface !== 'terminal' ? { Svg: table.Svg } : {}) }
  return { ui, s, t: themeOf(s), w: Math.max(16, e.props.bodyColumns - 2), now: await $.clock.now(), root, desk: e.surface !== 'terminal' }
}

// The side pane whole: header, tabs, and the open tab
export function fullPane(on: Parameters<Register>[0], rootOf: () => string) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const v = await paneV($, e, rootOf())
    if (!v) {
      const { Text } = $.ui.resolve(e)
      return <Text>Cockpit needs a surface with fields.</Text>
    }
    const { s, t } = v
    const { Box } = v.ui
    // A palette paints its own background over the whole pane, so its text reads on any terminal
    const rows = (e.props as { scroll?: { bodyRows?: number } }).scroll?.bodyRows
    return (
      <Box flexDirection="column" paddingX={1} backgroundColor={t.bg || undefined} {...(t.bg && rows ? { minHeight: rows } : {})}>
        {Header($, v)}
        {Tabs($, v)}
        {s.tab === 'overview' && Overview($, v)}
        {s.tab === 'files' && Files($, v)}
        {s.tab === 'agents' && Agents($, v)}
        {s.tab === 'git' && Git($, v)}
        {s.tab === 'rules' && Rules($, v)}
      </Box>
    )
  })
}
