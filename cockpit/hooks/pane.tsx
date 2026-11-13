import { look } from './ops/core'
import type { Frozen, Register, RenderChildren, RenderInput } from 'claude-code'
import { PANE } from './state'
import { themeOf } from './theme'
import { Header, Tabs } from './tabs/header'
import type { $, UI, V } from './tabs/shared'


// What the side pane draws with: the surface's elements, the state and the theme; null on a surface with no fields
export async function paneV($: $, e: Frozen<RenderInput<'Pane'>>, root: string): Promise<V | null> {
  const table = $.ui.resolve(e)
  if (!('Input' in table) || !('Select' in table)) return null
  const s = await look($)
  const ui: UI = { Box: table.Box, Text: table.Text, Button: table.Button, Input: table.Input, Select: table.Select, ...('Svg' in table && e.surface !== 'terminal' ? { Svg: table.Svg } : {}) }
  return { ui, s, t: themeOf(s), w: Math.max(16, e.props.bodyColumns - 2), now: await $.clock.now(), root, desk: e.surface !== 'terminal' }
}

// A part of the pane, on the pane's padding and the theme's background
export function piece(v: V, ...kids: RenderChildren[]) {
  return (
    <v.ui.Box flexDirection="column" paddingX={1} backgroundColor={v.t.bg || undefined}>
      {kids}
    </v.ui.Box>
  )
}

// The pane's frame (header and tabs) and the open tab's view are drawn as separate parts, each around what was drawn
// beneath it, so a plugin hooking the same pane can add a tab's view
// ponytail: each part paints its own background, so a palette leaves the pane's unused rows unpainted
export function paneFrame(on: Parameters<Register>[0], rootOf: () => string) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const v = await paneV($, e, rootOf())
    if (!v) {
      const { Text } = $.ui.resolve(e)
      return <Text>Cockpit needs a surface with fields.</Text>
    }
    const below = await next(e)
    return (
      <v.ui.Box flexDirection="column">
        {piece(v, Header($, v), Tabs($, v))}
        {below}
      </v.ui.Box>
    )
  })
}
