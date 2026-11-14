import { expect, test } from 'claude-code/testing'
import { setJudgeModels, seatModel } from '../hooks/judges/judges'

// The install screen's and /config's choices (plugin.json userConfig) against the settings Cockpit already saved
function stand(on: any, store: Record<string, any>, notes: string[]) {
  on('clock.every', async () => ({ value: {} }) as never)
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('command.register', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 1, context: { window: 200000, tokens: 1, percent: 0, breakdown: { categories: [], totalTokens: 1 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('session.append', async (_: unknown, e: any, next: any) => (notes.push(JSON.stringify(e.message)), next(e)))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: false } }))
  on('ui.panes', async () => ({ value: [] }) as never)
  on('store.get', async (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', async (_: unknown, e: any) => ((store[e.key] = JSON.parse(JSON.stringify(e.value ?? null))), { value: undefined }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('fs.exists', async () => ({ value: false }))
  on('fs.read', async () => {
    throw new Error('ENOENT')
  })
  on('fs.write', async () => ({ value: undefined }))
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
}
const start = async ($: any) => {
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
}
const chosen = { theme: 'nord', mode: 'ask', testAgents: false, autoVerify: true, notifyDone: true, dailyBudget: 5 }

test('a first run takes what the install screen chose, saves it, and says where to change it', { options: chosen, timeoutMs: 20_000 }, async ($, on) => {
  const store: Record<string, any> = {}
  const notes: string[] = []
  stand(on, store, notes)
  await start($)
  expect(store.prefs).toMatchObject({ theme: 'nord', mode: 'ask', testAgents: false, autoVerify: true, dailyBudget: 5 })
  expect(notes.join()).toContain('Cockpit is set up')
})

test('an upgrade keeps the settings it saved, whatever the options say, and is not greeted', { options: chosen, timeoutMs: 20_000 }, async ($, on) => {
  const store: Record<string, any> = { prefs: { theme: 'black', mode: 'off', testAgents: true } }
  const notes: string[] = []
  stand(on, store, notes)
  await start($)
  expect(store.prefs).toEqual({ theme: 'black', mode: 'off', testAgents: true })
  expect(store.appliedOptions).toMatchObject({ theme: 'nord' })
  expect(notes.join()).not.toContain('Cockpit is set up')
})

test('/config changing one field changes that one; a /cockpit choice of another stands', { options: { ...chosen, mode: 'off', dailyBudget: 0 }, timeoutMs: 20_000 }, async ($, on) => {
  // nord and ask applied before; since then /cockpit theme picked paper
  const store: Record<string, any> = { prefs: { theme: 'paper', mode: 'ask', dailyBudget: 5 }, appliedOptions: chosen }
  stand(on, store, [])
  await start($)
  expect(store.prefs.theme).toBe('paper')
  expect(store.prefs.mode).toBe('off')
  // 0 is no budget
  expect(store.prefs.dailyBudget).toBeUndefined()
})

test('the judges vote on haiku unless the setting mixes models in, seat by seat; an unknown setting is fast', () => {
  setJudgeModels('wide')
  expect([0, 1, 2, 3].map(seatModel)).toEqual(['haiku', 'sonnet', 'opus', 'haiku'])
  setJudgeModels('mixed')
  expect([0, 1, 2].map(seatModel)).toEqual(['haiku', 'sonnet', 'haiku'])
  setJudgeModels('bogus')
  expect(seatModel(4)).toBe('haiku')
})
