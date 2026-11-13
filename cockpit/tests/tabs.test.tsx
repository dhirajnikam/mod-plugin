import { expect, test } from 'claude-code/testing'

// Opening a tab: one way in, whoever asks for it
const scroll = { offset: 0, bodyRows: 40 }
const pane = { plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 100, placement: 'dock', scroll, view: {} } }
const commit = { plugin: 'cockpit', surface: 'terminal', component: 'ToolUse', requestId: 'tu2', props: { tool_use_id: 'tu2', tool: 'Bash', input: { command: 'git commit -m x' }, output: '[main abc1234] feat: x', isRunning: false, isErrored: false, isInterrupted: false } }

const stand = (on: any) => {
  const seen: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('ui.toast', async () => ({ value: undefined }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.open', async () => (seen.push('open'), { value: { isPlaced: true } }))
  on('agent.list', async () => (seen.push('agents'), { value: [] }))
  on('process.run', async (_: unknown, e: any) => {
    const argv = e.argv as string[]
    if (argv[0] === 'git' || argv[0] === 'gh') seen.push(argv[0])
    return { value: { exitCode: argv.join(' ') === 'git rev-parse --show-toplevel' ? 0 : 1, stdout: '/repo\n', stderr: '' } } as never
  })
  return seen
}

test("a tab's button reads what the tab shows, as /cockpit tab does: Agents asks the engine for its agents", async ($, on) => {
  const seen = stand(on)
  const ui = await $.ui.mount(pane as never)
  seen.length = 0
  await ui.press({ key: 'tab-agents' })
  expect(seen).toContain('agents')
  const byButton = JSON.stringify(await ui.drawn())
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  seen.length = 0
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  expect(seen).toContain('agents')
  expect(JSON.stringify(await ui.drawn())).toBe(byButton)
  await ui.unmount()
})

test('/cockpit tab with a word that is no tab leaves the open tab as it is', async ($, on) => {
  stand(on)
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const ui = await $.ui.mount(pane as never)
  const before = JSON.stringify(await ui.drawn())
  // Words every object answers to are no tabs either
  for (const word of ['nowhere', 'toString', 'constructor', '__proto__']) {
    await $.command.run({ command: 'cockpit', args: `tab ${word}` } as never)
    expect(JSON.stringify(await ui.drawn())).toBe(before)
  }
  await ui.unmount()
})

test('a card in the chat opens the pane on its tab at once, and reads the tab after', async ($, on) => {
  const seen = stand(on)
  // Focus hides tool cards: off, so the commit's card is drawn
  await $.command.run({ command: 'cockpit', args: 'focus off' } as never)
  const card = await $.ui.mount(commit as never)
  seen.length = 0
  const key = /"key":"(card-[^"]+)"/.exec(JSON.stringify(await card.drawn()))?.[1]
  expect(key).toBeTruthy()
  await card.press({ key: key! })
  // The pane first: git and gh are slow, and a press that waits on them shows nothing meanwhile
  expect(seen[0]).toBe('open')
  expect(seen).toContain('git')
  await card.unmount()
  const ui = await $.ui.mount(pane as never)
  // The Git tab is the one open: its button is the bold one
  expect(JSON.stringify(await ui.find({ key: 'tab-git' }))).toContain('"bold":true')
  await ui.unmount()
})
