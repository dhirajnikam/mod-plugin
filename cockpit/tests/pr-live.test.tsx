import { expect, test } from 'claude-code/testing'

// The Git tab's pull request kept live: the 15 s timer (fired here by hand through its clock.every stand-in) reads gh
// pr checks again while a check is pending, every 30 s at most, and a run that finishes sends one notice
const sleep = (ms: number) => new Promise(res => (globalThis as any).setTimeout(res, ms))
const VIEW = (state = 'OPEN') => `{"number":7,"title":"Add x","url":"https://github.com/o/r/pull/7","state":"${state}","isDraft":false,"reviewDecision":""}`

function stand(on: any, o: { dirty?: () => boolean; now: () => number; checks: () => string; branch: () => string; shown: () => boolean; view: () => string; notices: { title?: string; text: string }[]; ran: string[]; prefs?: Record<string, unknown> }) {
  // Each dispatch of the 15 s timer waits for tick(); the others never fire
  const waiting: (() => void)[] = []
  on('clock.every', async (_: unknown, e: any) => {
    if (e.ms !== 15000) return new Promise(() => {}) as never
    await new Promise<void>(res => waiting.push(res))
    return { value: {} } as never
  })
  on('clock.now', async () => ({ value: o.now() }))
  on('command.register', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 1, context: { window: 200000, tokens: 1, percent: 0, breakdown: { categories: [], totalTokens: 1 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [{ id: 'cockpit', isPlaced: true, isShown: o.shown(), isFocused: false }] }) as never)
  on('ui.notify', async (_: unknown, e: any) => (o.notices.push({ title: e.title, text: String(e.text) }), { value: { isSent: true, channel: 'terminal' } }) as never)
  on('store.get', async (_: unknown, e: any) => ({ value: e.key === 'prefs' ? o.prefs : undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('fs.exists', async () => ({ value: false }))
  on('fs.read', async () => {
    throw new Error('ENOENT')
  })
  on('fs.write', async () => ({ value: undefined }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (e.argv as string[]).join(' ')
    o.ran.push(cmd)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out(`## ${o.branch()}\0${o.dirty?.() ? ' M a.txt\0' : ''}`)
    if (cmd.startsWith('git rev-parse --short') || cmd === 'git rev-parse HEAD') return out('abc1234\n')
    if (cmd.startsWith('git branch')) return out('main\nfeat/x\nfeat/y\n')
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    if (cmd.startsWith('gh pr view')) return out(o.view())
    // gh exits 8 while a check is pending and 1 when one failed, printing the JSON all the same
    if (cmd.startsWith('gh pr checks')) {
      const c = o.checks()
      return out(c, c.includes('"pending"') ? 8 : c.includes('"fail"') ? 1 : 0)
    }
    return out('', cmd.startsWith('git rev-parse --verify') ? 1 : 0)
  })
  return async () => {
    const r = waiting.shift()
    if (!r) throw new Error('the 15 s timer is not waiting')
    r()
    await sleep(80)
  }
}

const PENDING = '[{"name":"test","bucket":"pending"},{"name":"lint","bucket":"pass"}]'
const FAILED = '[{"name":"test","bucket":"fail","link":"https://github.com/o/r/actions/runs/42/job/1"},{"name":"lint","bucket":"pass"}]'
const PASSED = '[{"name":"test","bucket":"pass"},{"name":"lint","bucket":"pass"}]'
const PANE = { plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } }

async function start($: any) {
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await sleep(50)
}
const checksRead = (ran: string[]) => ran.filter(c => c.startsWith('gh pr checks')).length

test('a pending check is read again every 30 s while the pane is placed, the row turns red by itself, and the run that finishes sends one notice', { timeoutMs: 30_000 }, async ($, on) => {
  let now = 1_000_000
  let checks = PENDING
  const ran: string[] = []
  const notices: { title?: string; text: string }[] = []
  const tick = stand(on, { now: () => now, checks: () => checks, branch: () => 'feat/x', shown: () => false, view: () => VIEW(), notices, ran })
  await start($)
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  expect(checksRead(ran)).toBe(1)
  const ui = await $.ui.mount(PANE as never)
  for (const step of ['Account', 'Branch pattern', 'Message pattern', 'Commit mode', 'When']) await ui.press({ key: step === 'When' ? 'setup-done' : 'setup-next' })
  expect(JSON.stringify(await ui.drawn())).toContain('◌ 1 running')
  // 15 s on: too soon to ask again
  now += 15_000
  await tick()
  expect(checksRead(ran)).toBe(1)
  // 30 s on, still pending: asked again, no notice yet
  now += 15_000
  await tick()
  expect(checksRead(ran)).toBe(2)
  expect(notices).toEqual([])
  // The run fails: the next read turns the row red and sends one notice naming the job
  checks = FAILED
  now += 30_000
  await tick()
  expect(checksRead(ran)).toBe(3)
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('✗ 1 failed')
  expect(drawn).not.toContain('running')
  expect(notices).toEqual([{ title: 'CI failed on #7', text: 'test failed · Add x' }])
  // Nothing pending now: the timer asks no more, however long it runs
  now += 60_000
  await tick()
  now += 60_000
  await tick()
  expect(checksRead(ran)).toBe(3)
  expect(notices.length).toBe(1)
  await ui.unmount()
})

test('a run that passes says so; none while you watch the pane, none when the first read had nothing pending, and nothing asked once the PR closes or the branch changes', { timeoutMs: 30_000 }, async ($, on) => {
  let now = 1_000_000
  let checks = PENDING
  let branch = 'feat/x'
  let shown = false
  let view = VIEW()
  const ran: string[] = []
  const notices: { title?: string; text: string }[] = []
  const tick = stand(on, { now: () => now, checks: () => checks, branch: () => branch, shown: () => shown, view: () => view, notices, ran })
  await start($)
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  // Passed while the pane is not on screen: one notice
  checks = PASSED
  now += 30_000
  await tick()
  expect(notices).toEqual([{ title: 'CI passed on #7', text: 'Add x' }])
  // A new push, pending again, and finished while you watch the pane: no notice
  checks = PENDING
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  shown = true
  checks = PASSED
  now += 30_000
  await tick()
  expect(notices.length).toBe(1)
  // Already finished at the first read: nothing to tell
  shown = false
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  expect(notices.length).toBe(1)
  // Pending, then the PR is closed: one read sees it closed, then no more
  checks = PENDING
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  view = VIEW('CLOSED')
  now += 30_000
  await tick()
  const afterClosed = checksRead(ran)
  now += 30_000
  await tick()
  expect(checksRead(ran)).toBe(afterClosed)
  // Reopened with its run finished meanwhile: no late notice for the run it was waiting on before it closed
  view = VIEW()
  checks = PASSED
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  expect(notices.length).toBe(1)
  // Pending, then you switch branch: the row goes and nothing is asked
  view = VIEW()
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const before = checksRead(ran)
  branch = 'feat/y'
  view = ''
  now += 30_000
  await tick()
  now += 30_000
  await tick()
  expect(ran.filter(c => c.startsWith('gh pr checks') && c.endsWith('feat/x')).length).toBe(before)
  expect(notices.length).toBe(1)
})

test('with finish notices off, a finished run is not told; an unreadable answer is not taken for finished', { timeoutMs: 30_000 }, async ($, on) => {
  let now = 1_000_000
  let checks = PENDING
  const ran: string[] = []
  const notices: { title?: string; text: string }[] = []
  const prefs: Record<string, unknown> = { notifyDone: false }
  const tick = stand(on, { now: () => now, checks: () => checks, branch: () => 'feat/x', shown: () => false, view: () => VIEW(), notices, ran, prefs })
  await start($)
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  checks = PASSED
  now += 30_000
  await tick()
  expect(notices).toEqual([])
})

test('an unreadable answer from gh is not taken for a finished run: no notice, and it keeps asking', { timeoutMs: 30_000 }, async ($, on) => {
  let now = 1_000_000
  let checks = PENDING
  const ran: string[] = []
  const notices: { title?: string; text: string }[] = []
  const tick = stand(on, { now: () => now, checks: () => checks, branch: () => 'feat/x', shown: () => false, view: () => VIEW(), notices, ran })
  await start($)
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  checks = 'not json'
  now += 30_000
  await tick()
  expect(notices).toEqual([])
  checks = FAILED
  now += 30_000
  await tick()
  expect(checksRead(ran)).toBe(3)
})

test('after a push the row is read again although GitHub has not started the new run yet, so the run that starts late is still followed and told', { timeoutMs: 30_000 }, async ($, on) => {
  let now = 1_000_000
  let checks = PASSED
  let dirty = true
  const ran: string[] = []
  const notices: { title?: string; text: string }[] = []
  const tick = stand(on, { dirty: () => dirty, now: () => now, checks: () => checks, branch: () => 'feat/x', shown: () => false, view: () => VIEW(), notices, ran })
  await start($)
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const ui = await $.ui.mount(PANE as never)
  for (let i = 0; i < 4; i++) await ui.press({ key: 'setup-next' })
  await ui.press({ key: 'opt-push' })
  await ui.press({ key: 'setup-done' })
  // Commit and push: the read right after still sees the old run, all passed
  await ui.press({ key: 'git-commit' })
  dirty = false
  expect(ran.some(c => c.startsWith('git push'))).toBe(true)
  const afterPush = checksRead(ran)
  // 30 s on the new run has started: asked again although nothing showed pending
  checks = PENDING
  now += 30_000
  await tick()
  expect(checksRead(ran)).toBe(afterPush + 1)
  // and it fails: told
  checks = FAILED
  now += 30_000
  await tick()
  expect(notices).toEqual([{ title: 'CI failed on #7', text: 'test failed · Add x' }])
  // Then quiet: nothing pending, no push since
  const done = checksRead(ran)
  for (let i = 0; i < 5; i++) {
    now += 30_000
    await tick()
  }
  expect(checksRead(ran)).toBe(done)
  await ui.unmount()
})
