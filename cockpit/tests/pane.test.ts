import { expect, test } from 'claude-code/testing'

// End to end: under a second when the machine is quiet, but it can pass the 5 s default when the machine is busy
test('/cockpit opens the pane, and a theme switch reopens it', { timeoutMs: 20_000 }, async ($, on) => {
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
