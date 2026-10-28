import { expect, test } from 'claude-code/testing'

import { selfCheck } from '../hooks/logic'

test('/cockpit opens the pane, and a theme switch reopens it', async ($, on) => {
  const opened: string[] = []
  on('ui.open', async (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('command.run', async () => ({ text: '' }))
  const r = await $.command.run({ command: 'cockpit', args: '' } as never)
  expect(JSON.stringify(r)).toContain('Cockpit pane opened')
  await $.command.run({ command: 'cockpit', args: 'theme nord' } as never)
  expect(opened).toEqual(['cockpit', 'cockpit'])
})

test('the self-check of patterns, judges and parsing passes', async () => {
  expect(selfCheck()).toEqual([])
})
