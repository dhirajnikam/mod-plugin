import { editGuide, explainCodebase, inBackground, set, toast } from '../actions'
import type { $, V } from './shared'
import { sp } from './shared'

// The Overview's codebase guide row: ask for it, then open it, refresh it, or tell Claude what to change in it
export function Guide($: $, v: V) {
  const { Box, Button, Input, Text } = v.ui
  const { s, t } = v
  const g = s.guide
  const ask = (key: string, label: string) => <Button key={key} label={label} onPress={() => inBackground($, key, 'Asking Claude', () => explainCodebase($))} />
  const head = <Text size="footnote" bold color={t.dim}>CODEBASE GUIDE</Text>
  if (!g || !(g.exists ?? g.at))
    return (
      <Box flexDirection="column">
        {head}
        <Box columnGap={sp(v, 1)} alignItems="center" flexWrap="wrap">
          {ask('guide-explain', 'Explain this codebase')}
          <Text color={t.faint} size="footnote">{`Claude writes ${g?.path ?? 'docs/CODEBASE.md'}: what it is for, its layout, flow and approach`}</Text>
        </Box>
      </Box>
    )
  return (
    <Box flexDirection="column">
      {head}
      <Box columnGap={sp(v, 1)} alignItems="center" flexWrap="wrap">
        <Text color={t.text}>{g.path}</Text>
        <Text color={t.faint} size="footnote">{`written ${new Date(g.at).toISOString().slice(0, 16).replace('T', ' ')}`}</Text>
        {/* ponytail: the host has no call to open a file in the editor, so Open shows the path */}
        <Button key="guide-open" label="Open" onPress={() => toast($, `The guide is at ${g.path}`)} />
        {ask('guide-refresh', 'Refresh')}
      </Box>
      <Input key="guide-edit" placeholder="Ask Claude to change the guide…" value={s.ui.guideText ?? ''} submitLabel="send" onInput={(val: string) => set($, st => ({ ui: { ...st.ui, guideText: val } }))} onSubmit={(val: string) => editGuide($, val)} />
    </Box>
  )
}
