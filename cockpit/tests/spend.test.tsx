import { expect, test } from 'claude-code/testing'
// The Overview keeps all but its Now, Steps and Approach behind More
const more = async (ui: any) => { if (JSON.stringify(await ui.drawn()).includes('› More')) await ui.press({ key: 'fold-more' }) }
import { budgetLevel, costliest, dayOf, spendByDay, todaySpend, upsertSession } from '../hooks/spend'

// Noon on a day where you are, so a day's edge never depends on the machine's time zone
const noon = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
const ss = (id: string, startedAt: number, usd: number, turns = 1) => ({ id, startedAt, endedAt: startedAt + 600_000, usd, tokens: 1000, turns })

test("a session's spend is kept in place under its start, a new session beside it, the newest 200 kept", () => {
  let list = upsertSession([], ss('s1', noon(2026, 11, 1), 0.1))
  list = upsertSession(list, { ...ss('s1', noon(2026, 11, 1), 0.4, 3) })
  expect(list).toEqual([ss('s1', noon(2026, 11, 1), 0.4, 3)])
  // Dollars and turns never go down within a session (finished flows cleared, or a resume counting afresh)
  list = upsertSession(list, { ...ss('s1', noon(2026, 11, 1), 0.1, 1) })
  expect(list[0]).toMatchObject({ usd: 0.4, turns: 3 })
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
function stand(on: any, opt: { cost: () => number; startedAt: number | (() => number); disk: Record<string, string>; now?: () => number; notices?: { title?: string; text: string }[]; prefs?: Record<string, unknown> }) {
  const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  on('clock.now', async () => ({ value: opt.now ? opt.now() : noon(2026, 11, 8, 16) }))
  on('clock.every', async () => ({ value: {} }) as never)
  on('command.register', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }) as never)
  on('ui.notify', async (_: unknown, e: any) => (opt.notices?.push({ title: e.title, text: String(e.text) }), { value: { isSent: true, channel: 'terminal' } }) as never)
  on('store.get', async (_: unknown, e: any) => ({ value: e.key === 'prefs' ? opt.prefs : undefined }))
  // The store keeps what is saved, whole: a setting cleared is gone from it
  on('store.set', async (_: unknown, e: any) => {
    if (e.key === 'prefs' && opt.prefs) {
      for (const k of Object.keys(opt.prefs)) delete opt.prefs[k]
      Object.assign(opt.prefs, JSON.parse(JSON.stringify(e.value ?? {})))
    }
    return { value: undefined }
  })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: typeof opt.startedAt === 'function' ? opt.startedAt() : opt.startedAt, context: { window: 200000, tokens: 34000, percent: 17, breakdown: { categories: [], totalTokens: 34000 } }, rateLimits: [], cost: { usd: opt.cost() } } }) as never)
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
    '/repo/.cockpit/history.json': JSON.stringify({ version: 1, flows: [], agents: [], commits: [], sessions: [ss('s-earlier', noon(2026, 11, 6), 3.1, 12), ss('s-other', noon(2026, 11, 2), 0.9, 4), { id: 'junk', usd: 'lots' }, { ...ss('neg', noon(2026, 11, 5), 1), usd: -4 }, { ...ss('inf', noon(2026, 11, 5), 1), usd: 1e400 }, { ...ss('noturns', noon(2026, 11, 5), 1), turns: undefined }] }),
  }
  stand(on, { cost: () => usd, startedAt: started, disk })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  await prompt($, 'fix the login')
  await turnDone($, 'fix the login')
  // Meanwhile another session in this repository saves its own record to the same file
  const other = JSON.parse(disk['/repo/.cockpit/history.json']!)
  other.sessions.push(ss('s-parallel', noon(2026, 11, 8, 13), 0.4, 2))
  disk['/repo/.cockpit/history.json'] = JSON.stringify(other)
  usd = 0.75
  await prompt($, 'and the tests')
  await turnDone($, 'and the tests')
  const saved = JSON.parse(disk['/repo/.cockpit/history.json']!).sessions as ReturnType<typeof ss>[]
  // The earlier sessions kept (the unreadable and negative ones dropped), the other session's record written meanwhile
  // kept, and this one recorded once, with its latest figures
  expect(saved.map(x => x.id)).toEqual(['s-other', 's-earlier', 's-parallel', `s${started}`])
  const mine = saved.find(x => x.id === `s${started}`)!
  expect(mine).toMatchObject({ startedAt: started, usd: 0.75, tokens: 34000, turns: 2 })
  expect(mine.endedAt).toBe(noon(2026, 11, 8, 16))
  // The Overview's Earlier sessions: spend by day and the costliest, labelled as estimates
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ui = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} } } as never)
  await more(ui)
  expect(JSON.stringify(await ui.drawn())).toContain('≈ $5.15 in 14 days')
  await ui.press({ key: 'fold-past' })
  const d = JSON.stringify(await ui.drawn())
  expect(d).toContain("Spend, last 14 days ≈ $5.15 (estimates)")
  expect(d).toContain('Costliest sessions')
  expect(d).toContain('11-06 · 10:00 · 12 turns')
  expect(d).toContain('$3.10')
  expect(d).toContain('$0.75')
  await ui.unmount()
})

test('sessions all older than 14 days show no spend heading, and say nothing was spent when opened', { timeoutMs: 20_000 }, async ($, on) => {
  const disk: Record<string, string> = { '/repo/.cockpit/history.json': JSON.stringify({ version: 1, flows: [], agents: [], commits: [], sessions: [ss('s-old', noon(2026, 9, 1), 4)] }) }
  stand(on, { cost: () => 0, startedAt: 0, disk })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ui = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} } } as never)
  await more(ui)
  expect(JSON.stringify(await ui.drawn())).not.toContain('in 14 days')
  await ui.press({ key: 'fold-past' })
  const d = JSON.stringify(await ui.drawn())
  expect(d).toContain('Nothing spent in the last 14 days')
  expect(d).toContain('$4.00')
  await ui.unmount()
})

test("a daily budget's level: none, ok, near from 80%, over from 100%; today's spend counts only today's sessions", () => {
  expect(budgetLevel(7.99, 10)).toBe('ok')
  expect(budgetLevel(8, 10)).toBe('near')
  expect(budgetLevel(9.99, 10)).toBe('near')
  expect(budgetLevel(10, 10)).toBe('over')
  expect(budgetLevel(50, 10)).toBe('over')
  for (const none of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(budgetLevel(5, none)).toBe('none')
  const now = noon(2026, 11, 8, 18)
  expect(todaySpend([ss('today-a', noon(2026, 11, 8, 9), 1.5), ss('today-b', noon(2026, 11, 8, 13), 2), ss('yesterday', noon(2026, 11, 7, 23), 9)], now)).toBe(3.5)
  expect(todaySpend([], now)).toBe(0)
})

test('a daily budget warns at 80% and at 100%, once each a day, the band amber then red, a new day quiet; nothing is stopped', { timeoutMs: 30_000 }, async ($, on) => {
  let usd = 1
  let now = noon(2026, 11, 8, 10)
  let started = noon(2026, 11, 8, 9)
  const notices: { title?: string; text: string }[] = []
  // Finish notices off: the budget warns all the same
  const prefs: Record<string, unknown> = { notifyDone: false }
  stand(on, { cost: () => usd, startedAt: () => started, disk: {}, now: () => now, notices, prefs })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  await prompt($, 'first')
  await turnDone($, 'first')
  // Set the budget in the Overview's Earlier sessions: text that is not a positive number is refused, $10 is kept
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const pane = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} } } as never)
  await more(pane)
  await pane.press({ key: 'fold-past' })
  for (const bad of ['lots', '1e3', '0x10', '0.004', '0', '-5', '5.505']) {
    await (pane as any).input({ key: 'budget-input', text: bad })
    expect(prefs.dailyBudget).toBe(undefined)
  }
  await (pane as any).input({ key: 'budget-input', text: '$10' })
  expect(prefs.dailyBudget).toBe(10)
  expect(JSON.stringify(await pane.drawn())).toContain('$1.00 of $10.00 today')
  const band = async () => {
    const b = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
    const d = JSON.stringify(await b.drawn())
    await b.unmount()
    return d
  }
  expect(await band()).toContain('$1.00 of $10.00 today')
  // 80%: one warning, the band amber; still 80% on the next turn: no second
  usd = 8.5
  await prompt($, 'second')
  await turnDone($, 'second')
  await prompt($, 'third')
  await turnDone($, 'third')
  expect(notices.filter(n => n.title?.startsWith('Daily budget'))).toEqual([{ title: 'Daily budget at 80%', text: '$8.50 of $10.00 spent today (estimates); nothing is stopped' }])
  // The Auto theme's amber and red, as Claude Code names them
  expect(await band()).toContain('{"color":"warning"},"children":["  ·  $8.50 of $10.00 today"]')
  // 100%: one more, the band red; and the session goes on (nothing is stopped)
  usd = 10.2
  await prompt($, 'fourth')
  await turnDone($, 'fourth')
  await prompt($, 'fifth')
  await turnDone($, 'fifth')
  expect(notices.filter(n => n.title?.startsWith('Daily budget')).map(n => n.title)).toEqual(['Daily budget at 80%', 'Daily budget reached'])
  expect(await band()).toContain('{"color":"error"},"children":["  ·  $10.20 of $10.00 today"]')
  expect(prefs.budgetWarned).toEqual({ day: '2026-11-08', level: 'over', budget: 10 })
  // The next day, a new session: quiet under 80%, and warned again once it crosses
  now = noon(2026, 11, 9, 10)
  started = noon(2026, 11, 9, 9)
  usd = 2
  await prompt($, 'next day')
  await turnDone($, 'next day')
  expect(notices.filter(n => n.title?.startsWith('Daily budget')).length).toBe(2)
  usd = 9
  await prompt($, 'next day again')
  await turnDone($, 'next day again')
  expect(notices.filter(n => n.title?.startsWith('Daily budget')).length).toBe(3)
  // With finish notices off, no turn told you it was done; only the budget spoke
  expect(notices.every(n => n.title?.startsWith('Daily budget'))).toBe(true)
  // Raised after a warning: crossing 80% of the new budget warns again
  await (pane as any).input({ key: 'budget-input', text: '20' })
  usd = 17
  await prompt($, 'raised')
  await turnDone($, 'raised')
  expect(notices.filter(n => n.title?.startsWith('Daily budget')).at(-1)).toEqual({ title: 'Daily budget at 80%', text: '$17.00 of $20.00 spent today (estimates); nothing is stopped' })
  // Another session warned at 100% of this budget meanwhile (as the store now says): this one stays quiet
  const before = notices.length
  prefs.budgetWarned = { day: '2026-11-09', level: 'over', budget: 20 }
  usd = 21
  await prompt($, 'other session warned')
  await turnDone($, 'other session warned')
  expect(notices.length).toBe(before)
  // Clear: no budget, no figure on the band
  await pane.press({ key: 'budget-clear' })
  expect(prefs.dailyBudget).toBe(undefined)
  expect(await band()).not.toContain('today')
  await pane.unmount()
})
