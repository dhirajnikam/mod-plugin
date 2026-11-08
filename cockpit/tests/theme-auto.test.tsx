import { expect, test } from 'claude-code/testing'

// Auto follows the terminal's background as Cockpit reads it at the session's start: COLORFGBG where the terminal
// sets it, else the Mac's appearance right now
function stand(on: any, o: { fgbg?: string; style: 'Dark' | 'light' | 'none' }) {
  on('clock.every', async () => new Promise(() => {}) as never)
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('command.register', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 1, context: { window: 200000, tokens: 1, percent: 0, breakdown: { categories: [], totalTokens: 1 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: [] }) as never)
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
    const out = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'printenv COLORFGBG') return o.fgbg ? out(`${o.fgbg}\n`) : out('', 1)
    if (cmd === 'defaults read -g AppleInterfaceStyle') return o.style === 'Dark' ? out('Dark\n') : o.style === 'light' ? out('', 1, 'The domain/default pair of (kCFPreferencesAnyApplication, AppleInterfaceStyle) does not exist\n') : out('', 127, 'defaults: not found')
    if (cmd.startsWith('git status')) return out('## main\0')
    return out('', 1)
  })
}
const band = async ($: any) => {
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  const b = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
  const d = JSON.stringify(await b.drawn())
  await b.unmount()
  return d
}
// Each palette's accent, as the band draws it
const BLACK = '#d4a35a'
const WHITE = '#9a6a22'

test('Auto on a Mac in dark appearance draws the Black palette, whatever Claude Code\'s own theme started as', { timeoutMs: 20_000 }, async ($, on) => {
  stand(on, { style: 'Dark' })
  const d = await band($)
  expect(d).toContain(BLACK)
  expect(d).not.toContain(WHITE)
})

test('Auto on a Mac in light appearance draws the White palette', { timeoutMs: 20_000 }, async ($, on) => {
  stand(on, { style: 'light' })
  const d = await band($)
  expect(d).toContain(WHITE)
  expect(d).not.toContain(BLACK)
})

test('COLORFGBG, where the terminal sets it, wins over the system: a light background (15) draws White on a dark Mac', { timeoutMs: 20_000 }, async ($, on) => {
  stand(on, { fgbg: '0;15', style: 'Dark' })
  expect(await band($)).toContain(WHITE)
})

test('with neither (not a Mac, no COLORFGBG) Auto keeps Claude Code\'s own theme keys', { timeoutMs: 20_000 }, async ($, on) => {
  stand(on, { style: 'none' })
  const d = await band($)
  expect(d).not.toContain(BLACK)
  expect(d).not.toContain(WHITE)
})
