import { expect, test } from 'claude-code/testing'
import { costliest, dayOf, spendByDay, upsertSession } from '../hooks/spend'

// Noon on a day where you are, so a day's edge never depends on the machine's time zone
const noon = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
const ss = (id: string, startedAt: number, usd: number, turns = 1) => ({ id, startedAt, endedAt: startedAt + 600_000, usd, tokens: 1000, turns })

test("a session's spend is kept in place under its start, a new session beside it, the newest 200 kept", () => {
  let list = upsertSession([], ss('s1', noon(2026, 11, 1), 0.1))
  list = upsertSession(list, { ...ss('s1', noon(2026, 11, 1), 0.4, 3) })
  expect(list).toEqual([ss('s1', noon(2026, 11, 1), 0.4, 3)])
  list = upsertSession(list, ss('s2', noon(2026, 11, 2), 1.2))
  expect(list.map(x => x.id)).toEqual(['s1', 's2'])
  const many = Array.from({ length: 205 }, (_, i) => ss(`m${i}`, noon(2026, 1, 1) + i * 1000, 0.01))
  const capped = many.reduce((acc, x) => upsertSession(acc, x), [] as ReturnType<typeof ss>[])
  expect(capped.length).toBe(200)
  expect(capped[0]!.id).toBe('m5')
})

test('spend by day covers 14 days, oldest first, a day with none at $0, a session on the day it started; and the five costliest', () => {
  const now = noon(2026, 11, 8, 15)
  const list = [
    ss('a', noon(2026, 11, 8, 9), 1.5),
    ss('b', noon(2026, 11, 8, 11), 0.25),
    ss('c', noon(2026, 11, 3), 2),
    // Before the window: left out
    ss('old', noon(2026, 10, 25), 9),
    // The window's first day
    ss('edge', noon(2026, 10, 26), 0.5),
  ]
  const days = spendByDay(list, now, 14)
  expect(days.length).toBe(14)
  expect(days[0]).toEqual({ day: '2026-10-26', usd: 0.5, sessions: 1 })
  expect(days[13]).toEqual({ day: '2026-11-08', usd: 1.75, sessions: 2 })
  expect(days.find(d => d.day === '2026-11-03')).toEqual({ day: '2026-11-03', usd: 2, sessions: 1 })
  expect(days.find(d => d.day === '2026-11-05')).toEqual({ day: '2026-11-05', usd: 0, sessions: 0 })
  expect(days.reduce((a, d) => a + d.usd, 0)).toBe(4.25)
  // The dearest first; two that cost the same, newest first
  expect(costliest([...list, ss('tie', noon(2026, 11, 7), 2)], 5).map(x => x.id)).toEqual(['old', 'tie', 'c', 'a', 'edge'])
  expect(dayOf(noon(2026, 1, 5))).toBe('2026-01-05')
})

// A session against an in-memory disk; usage says when it started and what it has cost so far
function stand(on: any, opt: { cost: () => number; startedAt: number; disk: Record<string, string> }) {
  const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  on('clock.now', async () => ({ value: noon(2026, 11, 8, 16) }))
  on('clock.every', async () => ({ value: {} }) as never)
  on('command.register', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }) as never)
  on('ui.notify', async () => ({ value: { isSent: false, reason: 'no-channel' } }) as never)
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: opt.startedAt, context: { window: 200000, tokens: 34000, percent: 17, breakdown: { categories: [], totalTokens: 34000 } }, rateLimits: [], cost: { usd: opt.cost() } } }) as never)
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('fs.exists', async (_: unknown, e: any) => ({ value: posix(e.path) in opt.disk }))
  on('fs.read', async (_: unknown, e: any) => {
    if (!(posix(e.path) in opt.disk)) throw new Error('ENOENT')
    return { value: opt.disk[posix(e.path)] } as never
  })
  on('fs.write', async (_: unknown, e: any) => ((opt.disk[posix(e.path)] = String(e.text)), { value: undefined }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (e.argv as string[]).join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out('## main\0')
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    return out('', cmd.startsWith('git rev-parse --verify') ? 1 : 0)
  })
}
const prompt = async ($: any, text: string) => {
  await $.prompt.submit({ text, command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text, turnId: text } as never).catch(() => null)
}
const turnDone = ($: any, turnId: string) => $.turn.complete({ answer: 'ok', reason: 'answer', turnId, isAborted: false, durationMs: 1000 } as never)

test("each session's spend is saved in history at every turn's end, kept in place, beside the earlier sessions read back", { timeoutMs: 20_000 }, async ($, on) => {
  let usd = 0.3
  const started = noon(2026, 11, 8, 14)
  const disk: Record<string, string> = {
    '/repo/.cockpit/history.json': JSON.stringify({ version: 1, flows: [], agents: [], commits: [], sessions: [ss('s-earlier', noon(2026, 11, 6), 3.1, 12), ss('s-other', noon(2026, 11, 2), 0.9, 4), { id: 'junk', usd: 'lots' }] }),
  }
  stand(on, { cost: () => usd, startedAt: started, disk })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  await prompt($, 'fix the login')
  await turnDone($, 'fix the login')
  usd = 0.75
  await prompt($, 'and the tests')
  await turnDone($, 'and the tests')
  const saved = JSON.parse(disk['/repo/.cockpit/history.json']!).sessions as ReturnType<typeof ss>[]
  // The earlier sessions kept (the unreadable one dropped), this one recorded once, with its latest figures
  expect(saved.map(x => x.id)).toEqual(['s-other', 's-earlier', `s${started}`])
  const mine = saved.find(x => x.id === `s${started}`)!
  expect(mine).toMatchObject({ startedAt: started, usd: 0.75, tokens: 34000, turns: 2 })
  expect(mine.endedAt).toBe(noon(2026, 11, 8, 16))
  // The Overview's Earlier sessions: spend by day and the costliest, labelled as estimates
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ui = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} } } as never)
  expect(JSON.stringify(await ui.drawn())).toContain('≈ $4.75 in 14 days')
  await ui.press({ key: 'fold-past' })
  const d = JSON.stringify(await ui.drawn())
  expect(d).toContain("Spend, last 14 days ≈ $4.75 (Claude Code's estimates)")
  expect(d).toContain('Costliest sessions')
  expect(d).toContain('11-06 · 10:00 · 12 turns')
  expect(d).toContain('$3.10')
  expect(d).toContain('$0.75')
  await ui.unmount()
})
