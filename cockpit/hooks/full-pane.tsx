import type { Register } from 'claude-code'
import { PANE } from './state'
import { paneV } from './pane'
import { Agents, Files, Git, Header, Overview, Rules, Tabs } from './views'

// The side pane whole: header, tabs, and the open tab (drawn in parts, frame and view: pane.tsx)
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
