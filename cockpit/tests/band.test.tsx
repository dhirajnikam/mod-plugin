import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'cockpit',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 90, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

// Every bordered Box in a drawn tree
const borders = (n: unknown): string[] => {
  if (!n || typeof n !== 'object') return []
  const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const own = el.props?.borderStyle ? [`${el.type}:${String(el.props.borderStyle)}`] : []
  return [...own, ...(Array.isArray(el.children) ? el.children : []).flatMap(borders)]
}

test('the band is a bordered box with Focus on, and again after pressing Focus off', async $ => {
  const ui = await $.ui.mount(BAND as never)
  const first = JSON.stringify(await ui.drawn())
  expect(borders(await ui.drawn())).toContain('Box:round')
  expect(first).toContain('◉ Focus')
  await ui.press({ key: 'ph-focus' })
  const after = await ui.drawn()
  expect(JSON.stringify(after)).toContain('Progress')
  expect(borders(after)).toContain('Box:round')
  await ui.unmount()
})
