import { expect, test } from 'claude-code/testing'

// A session working in a subfolder of its repository, with auto-commit and push on: the setup that failed with
// "git add failed: could not open directory 'cockpit/cockpit/'" and never auto-committed a turn's shell edits
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('from a subfolder, a turn that changed files by any means is committed and pushed at the repository root', async ($, on) => {
  const ran: { cmd: string; cwd: string }[] = []
  const toasts: string[] = []
  const store: Record<string, unknown> = {
    'git:/repo/cockpit': { commitMode: 'auto', autoWhen: 'step', push: true, branchAuto: false, setupDone: true, base: 'master' },
  }
  let edited = false
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('ui.toast', async (_: unknown, e: any) => (toasts.push(String(e.text)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('session.append', async (_: unknown, e: any, next: any) => next(e))
  on('session.cwd', async () => ({ value: '/repo/cockpit' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.measure', async () => ({ changed: [] }))
  on('config.list', async () => ({ value: [] }))
  on('store.get', async (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', async (_: unknown, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('fs.list', async () => ({ value: [] }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('command.register', async () => ({ value: {} }) as never)
  on('clock.every', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo/cockpit' }))
  on('process.run', async (_: unknown, e: any) => {
    const argv = Object.values(e as object).find(Array.isArray) as string[]
    const cmd = argv.join(' ')
    ran.push({ cmd, cwd: String(e.cwd ?? e.init?.cwd ?? '') })
    if (cmd === 'git rev-parse --show-toplevel') return ok('/repo\n')
    // A shell edit during the turn: the repository shows the change once the turn has run
    if (cmd.startsWith('git status')) return ok(edited ? '## master\0 M cockpit/a.ts\0' : '## master\0')
    if (cmd.startsWith('git rev-parse --short')) return ok('abc1234\n')
    return ok('')
  })
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  await $.session.start({ source: 'startup', cwd: '/repo/cockpit', surface: 'terminal', isInteractive: true } as never)
  await new Promise(res => (globalThis as any).setTimeout(res, 300))
  // The settings saved under the subfolder moved to the repository
  expect((store['git:/repo'] as any)?.commitMode).toBe('auto')
  expect(store['git:/repo/cockpit']).toBeNull()
  await $.prompt.submit({ text: 'fix the limiter', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  edited = true
  await $.turn.complete({ answer: 'done', reason: 'answer', turnId: 't', isAborted: false, durationMs: 1000 } as never)
  const add = ran.find(r => r.cmd.startsWith('git add'))
  expect(add?.cmd).toBe('git add -A -- cockpit/a.ts')
  expect(add?.cwd).toBe('/repo')
  expect(ran.some(r => r.cmd.startsWith('git commit') && r.cwd === '/repo')).toBe(true)
  expect(ran.some(r => r.cmd === 'git push -u origin master' && r.cwd === '/repo')).toBe(true)
  expect(toasts.join('|')).toContain('Auto-committed abc1234')
  expect(toasts.join('|')).toContain('pushed')
})
