import { expect, test } from 'claude-code/testing'
import { openMore } from './more'
import { inferType, ciKey } from '../hooks/git/git-form'

// The Git fixes, each driven the way it is met: the commit type from the files, the base branch, gh pr create, the
// project listing kept out of every git refresh, and the pull request's notices and give-up count
const sleep = (ms: number) => new Promise(res => (globalThis as any).setTimeout(res, ms))
const PANE = { plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } }
const VIEW = '{"number":7,"title":"Add x","url":"https://github.com/o/r/pull/7","state":"OPEN","isDraft":false,"reviewDecision":""}'
const PENDING = '[{"name":"test","bucket":"pending"}]'
const PASSED = '[{"name":"test","bucket":"pass"}]'
type Out = { exitCode: number; stdout: string; stderr?: string }
type Ran = { cmd: string; cwd?: string; env?: Record<string, string> }

// The engine stood in: `reply` answers a command (nothing: it ran and printed nothing); tick() fires the 15 s timer once
function stand(on: any, o: { reply: (cmd: string) => Out | Promise<Out> | undefined; now?: () => number; ran: Ran[]; notices?: string[]; toasts?: string[] }) {
  const waiting: (() => void)[] = []
  on('clock.every', async (_: unknown, e: any) => {
    if (e.ms !== 15000) return new Promise(() => {}) as never
    await new Promise<void>(res => waiting.push(res))
    return { value: {} } as never
  })
  on('clock.now', async () => ({ value: o.now?.() ?? 1_000_000 }))
  on('command.register', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 1, context: { window: 200000, tokens: 1, percent: 0, breakdown: { categories: [], totalTokens: 1 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('ui.toast', async (_: unknown, e: any) => (o.toasts?.push(String(e.text)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [{ id: 'cockpit', isPlaced: true, isShown: false, isFocused: false }] }) as never)
  on('ui.notify', async (_: unknown, e: any) => (o.notices?.push(String(e.title)), { value: { isSent: true, channel: 'terminal' } }) as never)
  on('store.get', async () => ({ value: undefined }))
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
    o.ran.push({ cmd, cwd: e.init?.cwd, env: e.init?.env })
    const r = (await o.reply(cmd)) ?? { exitCode: cmd === 'git rev-parse --show-toplevel' ? 0 : cmd.startsWith('git rev-parse --verify') || cmd.startsWith('git symbolic-ref') ? 1 : 0, stdout: cmd === 'git rev-parse --show-toplevel' ? '/repo\n' : cmd.startsWith('git rev-parse') ? 'abc1234\n' : '' }
    return { value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r } }
  })
  return async () => {
    const ready = async () => {
      for (let i = 0; i < 200 && !waiting.length; i++) await sleep(25)
      if (!waiting.length) throw new Error('the 15 s timer is not waiting')
    }
    await ready()
    waiting.shift()!()
    await ready()
  }
}
const count = (ran: Ran[], start: string) => ran.filter(r => r.cmd.startsWith(start)).length
const gitTab = ($: any) => $.command.run({ command: 'cockpit', args: 'tab git' } as never)
const setup = async (ui: any) => {
  await openMore(ui)
  for (const step of ['Account', 'Branch pattern', 'Message pattern', 'Commit mode', 'When']) await ui.press({ key: step === 'When' ? 'setup-done' : 'setup-next' })
}

test('a change is a test change only when every file is a test file by the memory map\'s rule, not when a path merely holds "test" or "spec"', async () => {
  expect(inferType('', ['src/inspector.ts'])).toBe('feat')
  expect(inferType('', ['latest.ts', 'contest/entry.ts', 'src/specific.ts'])).toBe('feat')
  expect(inferType('', ['tests/a.ts', 'src/b.test.ts', 'pkg/__tests__/c.js', 'spec/d.rb', 'e.spec.tsx'])).toBe('test')
  expect(inferType('', ['tests/a.ts', 'src/app.ts'])).toBe('feat')
})

test('trunk is the repository\'s base when it is the only usual base branch: on it, no pull request is asked of gh', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran[] = []
  let branch = 'trunk'
  stand(on, { ran, reply: cmd => (cmd.startsWith('git status') ? { exitCode: 0, stdout: `## ${branch}\0` } : cmd.startsWith('git branch') ? { exitCode: 0, stdout: 'trunk\nfeat/x\n' } : cmd.startsWith('gh pr view') ? { exitCode: 0, stdout: VIEW } : undefined) })
  await gitTab($)
  expect(count(ran, 'gh pr view')).toBe(0)
  // Off the base, the branch's pull request is read
  branch = 'feat/x'
  await gitTab($)
  expect(count(ran, 'gh pr view')).toBe(1)
})

test('the pull request a commit opens is asked of gh with prompts off, from the repository, like every other gh call', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran[] = []
  const toasts: string[] = []
  stand(on, {
    ran,
    toasts,
    reply: cmd =>
      cmd.startsWith('git status') ? { exitCode: 0, stdout: '## feat/x\0 M a.ts\0' }
      : cmd.startsWith('git diff --numstat') ? { exitCode: 0, stdout: '1\t0\ta.ts\0' }
      : cmd.startsWith('git branch') ? { exitCode: 0, stdout: 'main\nfeat/x\n' }
      : cmd.startsWith('gh pr view') ? { exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "feat/x"' }
      : cmd.startsWith('gh pr create') ? { exitCode: 0, stdout: 'https://github.com/o/r/pull/8\n' }
      : undefined,
  })
  await gitTab($)
  const ui = await $.ui.mount(PANE as never)
  await setup(ui)
  await openMore(ui)
  await ui.press({ key: 'git-more' })
  await ui.press({ key: 'opt-push' })
  await ui.press({ key: 'opt-pr' })
  await ui.press({ key: 'git-commit' })
  const made = ran.filter(r => r.cmd.startsWith('gh pr create'))
  expect(made.map(r => r.cmd)).toEqual(['gh pr create --base main --head feat/x --title feat: update a.ts --body feat: update a.ts'])
  expect(made[0]!.env?.GH_PROMPT_DISABLED).toBe('1')
  expect(made[0]!.cwd).toBe('/repo')
  expect(toasts.join('\n')).toContain('PR → main https://github.com/o/r/pull/8')
  await ui.unmount()
})

test('a git refresh does not list the project; opening the Activity tab does, from the session folder', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran[] = []
  stand(on, { ran, reply: cmd => (cmd.startsWith('git status') ? { exitCode: 0, stdout: '## feat/x\0' } : cmd.startsWith('git branch') ? { exitCode: 0, stdout: 'main\nfeat/x\n' } : cmd.startsWith('git ls-files') ? { exitCode: 0, stdout: 'README.md\0src/app.ts\0src/b.ts\0' } : undefined) })
  await gitTab($)
  await gitTab($)
  const ui = await $.ui.mount(PANE as never)
  expect(count(ran, 'git status')).toBe(2)
  expect(count(ran, 'git ls-files')).toBe(0)
  await $.command.run({ command: 'cockpit', args: 'tab files' } as never)
  const listed = ran.filter(r => r.cmd.startsWith('git ls-files'))
  expect(listed.length).toBe(1)
  expect(listed[0]!.cwd).toBeUndefined()
  await openMore(ui)
  expect(JSON.stringify(await ui.drawn())).toContain('3 files')
  await ui.unmount()
})

test('a finished run\'s notice key names the pull request, its run and the result, and nothing that changes between reads; two runs ending alike are each told once', { timeoutMs: 20_000 }, async ($, on) => {
  expect(ciKey('feat/x', 7, 1, true)).toBe('ci:feat/x#7:1:passed')
  expect(ciKey('feat/x', 7, 1, false)).not.toBe(ciKey('feat/x', 7, 1, true))
  expect(ciKey('feat/x', 7, 2, true)).not.toBe(ciKey('feat/x', 7, 1, true))
  const ran: Ran[] = []
  const notices: string[] = []
  let checks = PENDING
  let now = 1_000_000
  stand(on, { ran, notices, now: () => (now += 1000), reply: cmd => (cmd.startsWith('git status') ? { exitCode: 0, stdout: '## feat/x\0' } : cmd.startsWith('git branch') ? { exitCode: 0, stdout: 'main\nfeat/x\n' } : cmd.startsWith('gh pr view') ? { exitCode: 0, stdout: VIEW } : cmd.startsWith('gh pr checks') ? { exitCode: checks === PENDING ? 8 : 0, stdout: checks } : undefined) })
  await gitTab($)
  checks = PASSED
  await gitTab($)
  expect(notices).toEqual(['CI passed on #7'])
  // The finished run read again: nothing more
  await gitTab($)
  expect(notices.length).toBe(1)
  // A new push: its run, ending the same way, is told too
  checks = PENDING
  await gitTab($)
  checks = PASSED
  await gitTab($)
  expect(notices).toEqual(['CI passed on #7', 'CI passed on #7'])
})

test('answers gh could not give that a newer read has overtaken do not count toward giving up: the pending run is still asked after', { timeoutMs: 30_000 }, async ($, on) => {
  const ran: Ran[] = []
  let now = 1_000_000
  const held: (() => void)[] = []
  let view: () => Out | Promise<Out> = () => ({ exitCode: 0, stdout: VIEW })
  const tick = stand(on, { ran, now: () => now, reply: cmd => (cmd.startsWith('git status') ? { exitCode: 0, stdout: '## feat/x\0' } : cmd.startsWith('git branch') ? { exitCode: 0, stdout: 'main\nfeat/x\n' } : cmd.startsWith('gh pr view') ? view() : cmd.startsWith('gh pr checks') ? { exitCode: 8, stdout: PENDING } : undefined) })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await sleep(50)
  // A pending run is on the row
  await gitTab($)
  // Ten reads at once, gh offline for each: nine are overtaken before they answer, one is current
  view = () => new Promise<Out>(res => held.push(() => res({ exitCode: 1, stdout: '', stderr: 'error connecting to api.github.com' })))
  const reads = Array.from({ length: 10 }, () => gitTab($))
  for (let i = 0; i < 200 && held.length < 10; i++) await sleep(25)
  expect(held.length).toBe(10)
  for (const answer of held) answer()
  await Promise.all(reads)
  // gh is back: the timer still asks about the pending run
  view = () => ({ exitCode: 0, stdout: VIEW })
  const before = count(ran, 'gh pr view')
  now += 30_000
  await tick()
  expect(count(ran, 'gh pr view')).toBe(before + 1)
})
