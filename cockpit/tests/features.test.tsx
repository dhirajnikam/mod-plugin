import { expect, test } from 'claude-code/testing'

// Every feature driven end to end with the engine stood in: judges, testers, agents, files, commands, accounts, buttons
const scroll = { offset: 0, bodyRows: 60 }
const pane = (tab: string) => ({ plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll, view: {} } })
const band = { plugin: 'cockpit', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 90, scroll, view: {} } }
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

type Stubs = { votes?: number[]; score?: number; spawnFails?: boolean }
function stand($: unknown, on: any, st: Stubs = {}) {
  const log = { toasts: [] as string[], spawned: [] as string[], ran: [] as string[][], store: {} as Record<string, unknown>, stopped: [] as string[], asked: 0, theme: 'dark' }
  let seat = 0
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('ui.toast', async (_: unknown, e: any) => (log.toasts.push(String(e.text)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_: unknown, e: any) => {
    const a = Object.values(e as object).find(Array.isArray) as string[]
    log.ran.push(a)
    const cmd = a.join(' ')
    if (cmd.startsWith('git status')) return ok('## master\0 M a.txt\0')
    if (cmd.startsWith('git config --global user.name')) return ok('Dev\n')
    if (cmd.startsWith('git config --global user.email')) return ok('dev@x.io\n')
    if (cmd.startsWith('gh auth status')) return ok('github.com\n  ✓ Logged in to github.com account one (keyring)\n  - Active account: false\n\n  ✓ Logged in to github.com account two (keyring)\n  - Active account: true\n')
    if (cmd.startsWith('git rev-parse')) return ok('abc1234\n')
    return ok('')
  })
  on('store.get', async (_: unknown, e: any) => ({ value: log.store[e.key] }))
  on('store.set', async (_: unknown, e: any) => ((log.store[e.key] = e.value), { value: undefined }))
  on('config.list', async () => ({ value: [{ key: 'theme', value: log.theme }] }))
  on('config.set', async (_: unknown, e: any) => ({ value: e.value }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 50000, percent: 25, breakdown: { categories: [{ name: 'Messages', tokens: 30000 }, { name: 'System prompt', tokens: 20000 }], totalTokens: 50000 } }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('model.complete', async (_: unknown, e: any) => {
    const isScore = String(e.prompt).startsWith('Rate how complex')
    const text = isScore ? `{"score": ${st.score ?? 2}, "signals": ["small", "reversible"]}` : String(((st.votes ?? [1, 1, 1])[seat++ % (st.votes ?? [1]).length] ?? 0) + 1)
    return { value: { isAnswered: true, text, usage: { inputTokens: 1, outputTokens: 1 } } }
  })
  on('model.fork', async () => ({ value: { isAnswered: true, text: 'The task is small.', usage: { inputTokens: 1, outputTokens: 1 } } }))
  on('agent.spawn', async (_: unknown, e: any) => {
    log.spawned.push(String(e.description))
    return st.spawnFails ? { deny: 'no agents here' } : { model: 'haiku', agentId: `ag${log.spawned.length}` }
  })
  // The person answering a question: the second option
  on('tool.call', async (_: unknown, e: any) => {
    if (e.tool === 'TaskStop') log.stopped.push(String(e.task_id))
    if (e.tool === 'AskUserQuestion') return (log.asked++, { result: { questions: e.questions, answers: Object.fromEntries(e.questions.map((q: any) => [q.question, q.options[1]?.label ?? ''])) } })
    return { result: 'ok' }
  })
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  return log
}

test('judges decide a simple question for you, and a split goes to you', async ($, on) => {
  const log = stand($, on, { votes: [0, 0, 0], score: 2 })
  const q = { question: 'Which lib?', options: [{ label: 'date-fns' }, { label: 'dayjs' }], multiSelect: false, header: 'lib' }
  const r = (await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 't1', questions: [q] } as never)) as any
  expect(r.result?.answers?.['Which lib?']).toBe('date-fns')
  expect(log.toasts.some(t => t.includes('Judge 3/3 · date-fns'))).toBe(true)
  const ui = await $.ui.mount(pane('overview') as never)
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Which lib?')
  expect(drawn).toContain('3/3 → date-fns')
  await ui.unmount()
})

test('a split vote asks you instead', async ($, on) => {
  const log = stand($, on, { votes: [0, 1, 0, 1, 0, 1], score: 5 })
  const q = { question: 'Which lib?', options: [{ label: 'date-fns' }, { label: 'dayjs' }], multiSelect: false, header: 'lib' }
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 't2', questions: [q] } as never)
  expect(log.asked).toBe(1)
  expect(log.toasts.some(t => t.includes('Judges split'))).toBe(true)
  const ui = await $.ui.mount(pane('overview') as never)
  expect(JSON.stringify(await ui.drawn())).toContain('You chose · dayjs')
  await ui.unmount()
})

test('ask mode sends every question to you, judges never run', async ($, on) => {
  const log = stand($, on)
  await $.command.run({ command: 'cockpit', args: 'mode ask' } as never)
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 't3', questions: [{ question: 'Q?', options: [{ label: 'a' }, { label: 'b' }], multiSelect: false, header: 'q' }] } as never)
  expect(log.asked).toBe(1)
  expect(log.toasts.some(t => t.includes('Judge'))).toBe(false)
})

test('the testers start as subagents and their CASE lines fill the Tests tab and the band', async ($, on) => {
  const log = stand($, on)
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  expect(log.spawned).toEqual(['Positive tester', 'Negative tester'])
  const ag = await $.ui.mount(pane('agents') as never)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  expect(JSON.stringify(await ag.drawn())).toContain('Positive tester')
  await ag.unmount()
  const tc = await $.turn.complete({ agentId: 'ag1', answer: 'done\nCASE PASS login works\nCASE PASS logout works', reason: 'answer', turnId: 'x', isAborted: false, durationMs: 1000 } as never).catch(e => ({ err: String(e) }))
  expect(tc).toEqual({ text: '' })
  const ag2 = await $.ui.mount(pane('agents') as never)
  expect(JSON.stringify(await ag2.drawn())).toContain('[Done]')
  await ag2.unmount()
  await $.turn.complete({ agentId: 'ag2', answer: 'CASE FAIL empty password :: got 200', reason: 'answer', turnId: 'y', isAborted: false, durationMs: 1000 } as never)
  expect(log.toasts.filter(t => /tester/.test(t))).toEqual(['◆ Started the positive tester', '◆ Started the negative tester', '◆ Positive tester: 2/2 passed', '◆ Negative tester: 0/1 passed · 1 failing'])
  const ui = await $.ui.mount(pane('tests') as never)
  await $.command.run({ command: 'cockpit', args: 'tab tests' } as never)
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('2 of 3 cases passing · 1 failing')
  expect(drawn).toContain('empty password')
  expect(drawn).toContain('got 200')
  await ui.unmount()
  await $.command.run({ command: 'cockpit', args: 'focus on' } as never)
  const b = await $.ui.mount(band as never)
  expect(JSON.stringify(await b.drawn())).toContain('tests 2/3')
  await b.unmount()
})

test('a tester that cannot start says so', async ($, on) => {
  const log = stand($, on, { spawnFails: true })
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  expect(log.toasts.some(t => t.includes('could not start: no agents here'))).toBe(true)
})

test('subagents show in the Agents tab with their tool calls, and Stop stops them', async ($, on) => {
  const log = stand($, on)
  await $.agent.spawn({ tool_use_id: 'a1', prompt: 'look around', description: 'look around', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'x', background: false, fork: false } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/README.md', agentId: 'ag1' } as never)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane('agents') as never)
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('1 running')
  expect(drawn).toContain('1 total')
  expect(drawn).toContain('Explore')
  expect(drawn).toContain('1 tool calls')
  await ui.press({ key: 'stop-ag1' })
  expect(log.stopped).toEqual(['ag1'])
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('[Stopped]')
  // The form starts a new one
  await ui.press({ key: 'spawn-toggle' })
  await ui.drawn()
  await (ui as any).input({ key: 'spawn-task', text: 'write docs', kind: 'change' })
  await ui.drawn()
  await ui.press({ key: 'spawn-go' })
  expect(log.spawned).toContain('write docs')
  // The form closes once the agent has started; the kit hands no agentId back to the caller, so the row itself needs the engine
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toContain('spawn-task')
  await ui.unmount()
})

test('file operations build the Files tab, the chat cards and the progress steps', async ($, on) => {
  stand($, on)
  await $.prompt.submit({ text: 'add rate limiting', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/app.ts', tool_use_id: 'r1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b\nc', tool_use_id: 'e1' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/limit.ts', content: 'x\ny\nz', tool_use_id: 'w1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b1' } as never)
  await $.command.run({ command: 'cockpit', args: 'tab files' } as never)
  const ui = await $.ui.mount(pane('files') as never)
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('src/')
  expect(drawn).toContain('limit.ts')
  expect(drawn).toContain('"+5"')
  expect(drawn).toContain('" −1"')
  await ui.press({ key: 'fview-list' })
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"Edit   "')
  await ui.press({ key: 'opb-e1' })
  expect(JSON.stringify(await ui.drawn())).toContain('+ c')
  await ui.unmount()
  await $.command.run({ command: 'cockpit', args: 'focus off' } as never)
  const b = await $.ui.mount(band as never)
  const bd = JSON.stringify(await b.drawn())
  expect(bd).toContain('Verify')
  expect(bd).toMatch(/[5-9]\d%/)
  await b.unmount()
  const card = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'ToolUse', requestId: 'e1', props: { tool_use_id: 'e1', tool: 'Edit', input: {}, isRunning: false, isErrored: false, isInterrupted: false } } as never)
  expect(JSON.stringify(await card.drawn())).toContain('Edit app.ts')
  await card.unmount()
})

test('themes switch by command and by the header dots, and Auto follows the config', async ($, on) => {
  const log = stand($, on)
  await $.command.run({ command: 'cockpit', args: 'theme nord' } as never)
  let ui = await $.ui.mount(pane('overview') as never)
  expect(JSON.stringify(await ui.drawn())).toContain('#88c0d0')
  await ui.press({ key: 'theme-paper' })
  expect(JSON.stringify(await ui.drawn())).toContain('#b68235')
  await ui.press({ key: 'theme-auto' })
  expect(JSON.stringify(await ui.drawn())).toContain('#d4a35a')
  await ui.unmount()
  log.theme = 'light'
  await $.config.set({ key: 'theme', value: 'light' } as never).catch(() => null)
  ui = await $.ui.mount(pane('overview') as never)
  expect(JSON.stringify(await ui.drawn())).toContain('#9a6a22')
  await ui.unmount()
})

test('accounts are detected, saved across sessions and removed', async ($, on) => {
  const log = stand($, on)
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const ui = await $.ui.mount(pane('git') as never)
  await ui.press({ key: 'acct-detect' })
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('" two "')
  expect(drawn).toContain('" one "')
  await ui.press({ key: 'acct-add' })
  await (ui as any).input({ key: 'acct-label', text: 'Work' })
  await (ui as any).input({ key: 'acct-name', text: 'D N' })
  await (ui as any).input({ key: 'acct-email', text: 'd@work.io' })
  await ui.press({ key: 'acct-save' })
  expect((log.store.accounts as any[]).map(a => a.label)).toEqual(['Work'])
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('D N <d@work.io>')
  await ui.press({ key: 'acct-remove' })
  expect(log.store.accounts).toEqual([])
  await ui.unmount()
})

test('the context and cost come from the session usage', async ($, on) => {
  stand($, on)
  await $.session.measure({} as never)
  const ui = await $.ui.mount(pane('overview') as never)
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('50k')
  expect(drawn).toContain('$1.50')
  expect(drawn).toContain('Messages')
  await ui.unmount()
})
