import { expect, test } from 'claude-code/testing'
import { deskPane, ok, openMore, posix } from './more'
import { toOp, stepOf, activityOf, stepWords } from '../hooks/flows/tools'

// A main turn's bookkeeping: which tools count as an edit, which flow a turn's end closes, a refused prompt, and the
// hooks that must not fail the event they sit on
type Opt = { prefs?: Record<string, unknown>; refuse?: string; openFails?: boolean; noUsage?: boolean }
async function stand($: any, on: any, o: Opt = {}) {
  const disk: Record<string, string> = { '/repo/src/a.ts': 'export const a = 1\n', '/repo/lib/c.ts': 'export default 1\n' }
  const log = { disk, spawned: [] as string[], opened: 0, tracked: 'src/a.ts\0lib/c.ts\0' }
  const store: Record<string, unknown> = { prefs: { focus: true, theme: 'auto', mode: 'auto', autoVerify: false, testAgents: true, ...o.prefs } }
  // A clock that moves: a flow is named by the time it opened
  let clock = 1_000_000
  on('clock.now', async () => ({ value: (clock += 1000) }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => {
    if (o.openFails) throw new Error('no pane here')
    log.opened++
    return { value: { isPlaced: true } }
  })
  on('ui.panes', async () => ({ value: [] }) as never)
  on('session.append', async (_: unknown, e: any, next: any) => next(e))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: o.noUsage ? {} : { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('config.list', async () => ({ value: [] }))
  on('store.get', async (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', async (_: unknown, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('fs.list', async () => ({ value: [] }))
  on('fs.exists', async (_: unknown, e: any) => ({ value: posix(e.path) in disk }))
  on('fs.read', async (_: unknown, e: any) => {
    if (!(posix(e.path) in disk)) throw new Error('ENOENT')
    return { value: disk[posix(e.path)] } as never
  })
  on('fs.write', async (_: unknown, e: any) => ((disk[posix(e.path)] = e.text), { value: undefined }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('agent.list', async () => ({ value: [] }))
  on('agent.spawn', async (_: unknown, e: any) => (log.spawned.push(String(e.description)), { model: 'haiku', agentId: `ag${log.spawned.length}` }))
  on('command.register', async () => ({ value: {} }) as never)
  on('clock.every', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd === 'git rev-parse --show-toplevel') return ok('/repo\n')
    if (cmd.startsWith('git status')) return ok('## master\0')
    if (cmd.startsWith('git ls-files')) return ok(log.tracked)
    return ok('')
  })
  on('tool.call', async () => ({ result: 'ok' }))
  on('tool.check', async () => ({ decision: 'allow' }) as never)
  on('prompt.submit', async (_: unknown, e: any) => (o.refuse && e.text === o.refuse ? { drop: 'refused beneath' } : { text: e.text }) as never)
  on('turn.start', async (_: unknown, e: any) => ({ turnId: e.turnId }) as never)
  on('turn.complete', async () => ({ text: '' }))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  // The codebase memory is built in the background
  await new Promise(res => (globalThis as any).setTimeout(res, 300))
  return log
}
const prompt = ($: any, text: string) => $.prompt.submit({ text, command: null, isMeta: false, origin: { kind: 'composer' } } as never)
const end = ($: any, turnId: string) => $.turn.complete({ answer: 'done', reason: 'answer', turnId, isAborted: false, durationMs: 1000 } as never)
const flows = (disk: Record<string, string>): any[] => JSON.parse(disk['/repo/.cockpit/history.json'] ?? '{}').flows ?? []

test('a notebook edit and a multi-edit are file edits like Edit: an operation with its lines, the Implement step, the words', () => {
  const nb = toOp('NotebookEdit', { notebook_path: '/repo/n.ipynb', new_source: 'a = 1\nb = 2' }, 'x', 1)
  expect(nb).toMatchObject({ op: 'Edit', path: '/repo/n.ipynb', add: 2, del: 0 })
  const multi = toOp('MultiEdit', { file_path: '/repo/a.ts', edits: [{ old_string: 'one', new_string: 'two\nthree' }, { old_string: 'x\ny', new_string: 'z' }] }, 'y', 1)
  expect(multi).toMatchObject({ op: 'Edit', path: '/repo/a.ts', add: 3, del: 3, meta: '+3 −3' })
  for (const tool of ['NotebookEdit', 'MultiEdit']) expect(stepOf(tool, {})).toBe('Implement')
  expect(activityOf('NotebookEdit', { notebook_path: '/repo/n.ipynb' })).toBe('Editing n.ipynb')
  expect(activityOf('MultiEdit', { file_path: '/repo/a.ts' })).toBe('Editing a.ts')
  expect(stepWords('MultiEdit /repo/a.ts')).toBe('Editing a.ts')
})

test("the main loop's MultiEdit counts as the turn's change: the memory follows it, its flow reaches Implement, and the testers start", async ($, on) => {
  const log = await stand($, on, { prefs: { autoVerify: true } })
  await prompt($, 'change c')
  log.disk['/repo/lib/c.ts'] = "import { a } from '../src/a'\nexport default 2\n"
  await $.tool.call({ tool: 'MultiEdit', file_path: '/repo/lib/c.ts', edits: [{ old_string: '1', new_string: '2' }], tool_use_id: 'm1' } as never)
  expect(JSON.parse(log.disk['/repo/.cockpit/memory.json'] ?? '{}').files['lib/c.ts'].uses).toEqual(['src/a.ts'])
  await end($, 't')
  expect(flows(log.disk)[0]).toMatchObject({ task: 'change c', status: 'done', ops: 1, add: 1, del: 1 })
  expect(flows(log.disk)[0].reached).toContain('Implement')
  // Auto-verify is on and git shows no change of its own: only the edit says the turn changed a file
  expect(log.spawned.length).toBe(1)
})

test("a turn's end closes the flow the turn started in, not the one a prompt sent meanwhile has opened", async ($, on) => {
  const log = await stand($, on)
  await prompt($, 'first task')
  await $.turn.start({ text: 'first task', turnId: 't1' } as never)
  // Sent as the first turn ended, before its end was heard here: it opens the next flow
  await prompt($, 'second task')
  await end($, 't1')
  // The history keeps ended flows only: the first is done, the second still runs
  expect(flows(log.disk).map(f => [f.task, f.status, f.ms])).toEqual([['first task', 'done', 1000]])
  // And the second turn's own end closes the second
  await $.turn.start({ text: 'second task', turnId: 't2' } as never)
  await $.turn.complete({ answer: 'done', reason: 'answer', turnId: 't2', isAborted: false, durationMs: 2000 } as never)
  expect(flows(log.disk).map(f => [f.task, f.status, f.ms])).toEqual([['first task', 'done', 1000], ['second task', 'done', 2000]])
})

test('a refused prompt leaves the running flow before it running, so its turn still ends it done', async ($, on) => {
  const log = await stand($, on, { refuse: 'not this' })
  await prompt($, 'first task')
  const r: any = await prompt($, 'not this')
  expect(r.drop).toBe('refused beneath')
  await end($, 't1')
  expect(flows(log.disk).map(f => [f.task, f.status])).toEqual([['first task', 'done']])
})

test('/cockpit tab with a word that is no tab names the tabs and opens nothing', async ($, on) => {
  const log = await stand($, on)
  const was = log.opened
  const r: any = await $.command.run({ command: 'cockpit', args: 'tab nowhere' } as never)
  expect(r.text).toBe('Tabs: overview, files (Activity), agents, git, rules')
  expect(log.opened).toBe(was)
  expect(((await $.command.run({ command: 'cockpit', args: 'tab git' } as never)) as any).text).toBe('Cockpit pane opened.')
  expect(log.opened).toBe(was + 1)
})

test('a /cockpit sub-command that fails answers so instead of failing the command', async ($, on) => {
  await stand($, on, { openFails: true })
  const r: any = await $.command.run({ command: 'cockpit', args: '' } as never)
  expect(r.text).toContain('Cockpit could not run that')
})

test('a measurement Cockpit cannot read still goes through to the engine', async ($, on) => {
  await stand($, on, { noUsage: true })
  expect(await $.session.measure({} as never)).toEqual({ changed: [] })
})

test("the Activity tab's file list is read again when a turn ends, so a file the turn made is counted without reopening the tab", async ($, on) => {
  const log = await stand($, on)
  await $.command.run({ command: 'cockpit', args: 'tab files' } as never)
  const ui = await $.ui.mount(deskPane as never)
  await openMore(ui)
  expect(JSON.stringify(await ui.drawn())).toContain('2 files · ')
  await prompt($, 'add a file')
  log.tracked += 'src/fresh.ts\0'
  await end($, 't')
  expect(JSON.stringify(await ui.drawn())).toContain('3 files · ')
  await ui.unmount()
})

test("a turn's end closes its own flow even when the next turn started before it was heard", async ($, on) => {
  const log = await stand($, on)
  await prompt($, 'first task')
  await $.turn.start({ text: 'first task', turnId: 't1' } as never)
  await prompt($, 'second task')
  // The second turn starts before the first one's end reaches Cockpit
  await $.turn.start({ text: 'second task', turnId: 't2' } as never)
  await end($, 't1')
  expect(flows(log.disk).map(f => [f.task, f.status, f.ms])).toEqual([['first task', 'done', 1000]])
  await $.turn.complete({ answer: 'done', reason: 'answer', turnId: 't2', isAborted: false, durationMs: 2000 } as never)
  expect(flows(log.disk).map(f => [f.task, f.status, f.ms])).toEqual([['first task', 'done', 1000], ['second task', 'done', 2000]])
})
