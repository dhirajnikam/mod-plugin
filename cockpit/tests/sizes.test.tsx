import { expect, test } from 'claude-code/testing'

// Every computed run of text fits the width it is drawn in, from a narrow pane to a wide terminal
const WIDTHS = [28, 40, 60, 100, 160]
const TABS = ['overview', 'files', 'agents', 'git'] as const
const scroll = { offset: 0, bodyRows: 30 }

// Each row's text as drawn: a column Box starts new rows, anything else joins its row
const rows = (n: unknown): string[] => {
  // Bars and rules keep their length; other text wraps at its spaces, so only its longest word is rigid
  if (typeof n === 'string') return [/[━─]/.test(n) ? n.replace(/ +$/, '') : ' '.repeat(Math.max(0, ...n.split(/\s+/).map(x => x.length)))]
  if (!n || typeof n !== 'object') return []
  const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (el.props?.display === 'none') return []
  // A Button with no children draws its label, unbroken
  if (el.type === 'Button' && !(Array.isArray(el.children) && el.children.length)) return [' '.repeat(String(el.props?.label ?? '').length + 2)]
  const kids = (Array.isArray(el.children) ? el.children : []).map(rows)
  const pad = el.type === 'Box' ? Number(el.props?.paddingX ?? 0) * 2 + (el.props?.borderStyle ? 2 : 0) : 0
  if (el.type === 'Box' && (el.props?.flexDirection === 'column' || el.props?.flexWrap === 'wrap')) return kids.flat().map(r => r + ' '.repeat(pad))
  // A Text that wraps or truncates fits by itself
  if (el.type === 'Text' && el.props?.wrap && el.props.wrap !== 'wrap') return ['']
  if (el.type === 'Input' || el.type === 'Select' || el.type === 'Svg' || el.type === 'Raster') return ['']
  const gap = el.type === 'Box' ? Number(el.props?.gap ?? el.props?.columnGap ?? 0) : 0
  const lines = kids.filter(k => k.length)
  const width = lines.reduce((a, k) => a + Math.max(...k.map(s => s.length)), 0) + gap * Math.max(0, lines.length - 1) + pad
  return [' '.repeat(width)]
}

const wide = (tree: unknown, w: number) => rows(tree).filter(r => r.length > w).map(r => r.length)

// Every surface, tab and width: 4 to 5 s on a slow machine, past the 5 s default
test('the band, the pane and the chat cards fit every width', { timeoutMs: 20_000 }, async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  await $.tool.call({ tool: 'Edit', file_path: '/Users/someone/projects/app/src/features/authentication/login-form.tsx', old_string: 'a', new_string: 'b' } as never).catch(() => null)
  await $.tool.call({ tool: 'Read', file_path: '/Users/someone/projects/app/README.md' } as never).catch(() => null)
  const bad: string[] = []
  for (const focus of ['on', 'off']) {
    await $.command.run({ command: 'cockpit', args: `focus ${focus}` } as never)
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const w of WIDTHS) {
        const band = await $.ui.mount({ plugin: 'cockpit', surface, component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: w, scroll, view: {} } } as never)
        for (const n of wide(await band.drawn(), w)) bad.push(`${surface} band focus ${focus} @${w}: ${n}`)
        await band.unmount()
        for (const tab of TABS) {
          await $.command.run({ command: 'cockpit', args: `tab ${tab}` } as never)
          const pane = await $.ui.mount({ plugin: 'cockpit', surface, component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: w, placement: 'dock', scroll, view: {} } } as never)
          for (const n of wide(await pane.drawn(), w)) bad.push(`${surface} ${tab} @${w}: ${n}`)
          await pane.unmount()
        }
      }
    }
  }
  expect(bad).toEqual([])
})
