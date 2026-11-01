import { expect, test } from 'claude-code/testing'

// The layout's promises, each checked by drawing a tab with a pipeline, agents and a changed file
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
test('Activity tells one story: agents\' events fill the feed, so the tab never says it has nothing, and the count matches the rows', { timeoutMs: 20_000 }, async ($, on) => {
  let clock = 1_000_000
  let spawns = 0
  on('clock.now', async () => ({ value: (clock += 900) }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd.startsWith('git status')) return ok('## main\0 M src/auth.ts\0')
    return ok('')
  })
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('agent.spawn', async () => ({ model: 'haiku', agentId: `ag${++spawns}` }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  await $.prompt.submit({ text: 'fix the empty password bug in login', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/auth.ts', agentId: 'ag1', tool_use_id: 'x1' } as never)
  await $.turn.complete({ agentId: 'ag1', answer: 'CASE PASS login works\nCASE PASS logout works\nCASE PASS session expires\nREPORT: the three happy paths pass\nHANDOFF: try empty and very long passwords', reason: 'answer', turnId: 'x', isAborted: false, durationMs: 1000 } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test -- auth', agentId: 'ag2', tool_use_id: 'x2' } as never)
  await $.command.run({ command: 'cockpit', args: 'run reviewer -- review the login diff' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'password', agentId: 'ag3', tool_use_id: 'x3' } as never)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'ag2', tool_use_id: 'p2', todos: [{ content: 'Find the login handler', status: 'completed', activeForm: 'x' }, { content: 'Try empty passwords', status: 'completed', activeForm: 'x' }, { content: 'Try very long passwords', status: 'in_progress', activeForm: 'x' }, { content: 'Write the CASE lines', status: 'pending', activeForm: 'x' }] } as never)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'ag3', tool_use_id: 'p3', todos: [{ content: 'Read the login diff', status: 'in_progress', activeForm: 'x' }, { content: 'Check the error paths', status: 'pending', activeForm: 'x' }, { content: 'List the findings', status: 'pending', activeForm: 'x' }] } as never)
  await $.command.run({ command: 'cockpit', args: 'tab files' } as never)
  const ui = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} } } as never)
  const d = JSON.stringify(await ui.drawn())
  await ui.unmount()
  expect(d).not.toContain('No files found here yet')
  // Six events: the agents' tool calls and the Prover's report
  expect(d).toContain('6 events · 3 agents')
})
