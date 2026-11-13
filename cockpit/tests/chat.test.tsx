import { expect, test } from 'claude-code/testing'
import { ok } from './more'

// The chat around the prompt, driven the way a session does: what a turn came to, an agent's card, the band's live
// words and Compact, the spinner's step, and a card's press opening the pane
const scroll = { offset: 0, bodyRows: 60 }
const site = (component: string, requestId: string, props: object, surface = 'terminal') => ({ plugin: 'cockpit', surface, component, requestId, props })
const band = (surface = 'terminal') => site('AbovePrompt', 'band', { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 90, scroll, view: {} }, surface)
const drawn = async (m: { drawn: () => Promise<unknown> }) => JSON.stringify(await m.drawn())

function stand(on: any, opt: { percent?: number; cost?: () => number } = {}) {
  const log = { opened: 0, compacted: 0 }
  let clock = 1_000_000
  on('clock.now', async () => ({ value: (clock += 1000) }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => (log.opened++, { value: { isPlaced: true } }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd.startsWith('git status')) return ok('## main\0 M src/app.ts\0')
    return ok('')
  })
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.cwd', async () => ({ value: '/repo' }))
  const percent = opt.percent ?? 25
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: percent * 2000, percent, breakdown: { categories: [{ name: 'Messages', tokens: percent * 2000 }], totalTokens: percent * 2000 } }, rateLimits: [], cost: { usd: opt.cost ? opt.cost() : 0 } } }))
  on('session.compact', async () => (log.compacted++, { skip: 'the stand keeps the conversation' }) as never)
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  let spawns = 0
  on('agent.spawn', async () => ({ model: 'haiku', agentId: `ag${++spawns}` }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  return log
}
const prompt = ($: any, text: string) => $.prompt.submit({ text, command: null, isMeta: false, origin: { kind: 'composer' } } as never)

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the turn's line says what it came to on ${surface}, with Focus on and off`, { timeoutMs: 20_000 }, async ($, on) => {
    let usd = 0.1
    stand(on, { cost: () => usd })
    // A turn before it: the cost is read when a turn ends, so this one starts from $0.10
    await prompt($, 'look at the login')
    await $.turn.complete({ answer: 'ok', reason: 'answer', turnId: 't0', isAborted: false, durationMs: 4000 } as never)
    await prompt($, 'fix the login bug')
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b\nc', tool_use_id: 'e1' } as never)
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: 'x\ny\nz', tool_use_id: 'w1' } as never)
    usd = 0.31
    await $.turn.complete({ answer: 'done', reason: 'answer', turnId: 't', isAborted: false, durationMs: 9000 } as never)
    for (const focus of ['on', 'off']) {
      await $.command.run({ command: 'cockpit', args: `focus ${focus}` } as never)
      const line = await $.ui.mount(site('TurnDuration', 'td', { word: 'Done', durationMs: 9000 }, surface) as never)
      const d = await drawn(line)
      expect(d).toContain('Done · ready to commit')
      expect(d).toContain('2 files')
      expect(d).toContain('"+5"')
      expect(d).toContain('" −1"')
      expect(d).toContain('$0.21')
      expect(d).toContain('0:09')
      await line.unmount()
    }
    // The next turn's spending is its own: the finished turn's line keeps what it cost
    await prompt($, 'add a test')
    usd = 0.9
    await $.turn.complete({ answer: 'ok', reason: 'answer', turnId: 't2', isAborted: false, durationMs: 30000 } as never)
    await prompt($, 'and the docs')
    usd = 1.4
    await $.turn.complete({ agentId: 'ag9', answer: 'x', reason: 'answer', turnId: 'a', isAborted: false, durationMs: 1 } as never)
    const earlier = await $.ui.mount(site('TurnDuration', 'td', { word: 'Done', durationMs: 9000 }, surface) as never)
    expect(await drawn(earlier)).toContain('$0.21')
    await earlier.unmount()
  })

  test(`an agent's card shows its tool calls and time while it runs, then what its CASE lines found, on ${surface}`, { timeoutMs: 20_000 }, async ($, on) => {
    stand(on)
    await $.command.run({ command: 'cockpit', args: 'focus off' } as never)
    const input = { description: 'check the login', prompt: 'check the login', subagent_type: 'cockpit:prover' }
    await $.agent.spawn({ tool_use_id: 'a1', prompt: input.prompt, description: input.description, subagentType: input.subagent_type, provider: { plugin: 'cockpit', tier: 'user' }, parentModel: 'x', background: false, fork: false } as never)
    await $.tool.call({ tool: 'Read', file_path: '/repo/src/app.ts', agentId: 'ag1', tool_use_id: 'x1' } as never)
    const props = (isRunning: boolean) => ({ tool_use_id: 'a1', tool: 'Agent', input, isRunning, isErrored: false, isInterrupted: false })
    const run = await $.ui.mount(site('ToolUse', 'a1', props(true), surface) as never)
    expect(await drawn(run)).toMatch(/Running · 1 tool · \d+:\d\d/)
    // An expert by its name, not its type
    expect(await drawn(run)).toContain('Prover · check the login')
    await run.unmount()
    await $.turn.complete({ agentId: 'ag1', answer: 'CASE PASS login works\nCASE FAIL empty password | accepted\nREPORT: one gap', reason: 'answer', turnId: 'y', isAborted: false, durationMs: 1000 } as never)
    const done = await $.ui.mount(site('ToolUse', 'a1', props(false), surface) as never)
    expect(await drawn(done)).toContain('✗ 1 failed · 1/2')
    await done.unmount()
  })
}

test('the band names the agents at work, and offers Compact once the context is nearly full', async ($, on) => {
  const log = stand(on, { percent: 85 })
  await prompt($, 'map the code')
  // The context is read when a turn ends
  await $.turn.complete({ answer: 'ok', reason: 'answer', turnId: 't0', isAborted: false, durationMs: 4000 } as never)
  await $.agent.spawn({ tool_use_id: 'a1', prompt: 'look around', description: 'look around', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'x', background: false, fork: false } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/README.md', agentId: 'ag1', tool_use_id: 'x1' } as never)
  for (const focus of ['on', 'off']) {
    await $.command.run({ command: 'cockpit', args: `focus ${focus}` } as never)
    const b = await $.ui.mount(band() as never)
    const d = await drawn(b)
    expect(d).toContain('⧉ 1 agent')
    expect(d).toContain('Compact')
    await b.unmount()
  }
  const b = await $.ui.mount(band() as never)
  await b.press({ key: 'ph-compact' })
  // The press returns at once; the compaction runs on after it
  for (let i = 0; i < 50 && !log.compacted; i++) await new Promise(r => (globalThis as any).setTimeout(r, 10))
  expect(log.compacted).toBe(1)
  await b.unmount()
})

test('a band with room to spare has no Compact', async ($, on) => {
  stand(on)
  await prompt($, 'map the code')
  const b = await $.ui.mount(band() as never)
  expect(await drawn(b)).not.toContain('ph-compact')
  await b.unmount()
})

test("the spinner says which of the task's steps is in progress, and a card's press opens the pane on its tab", async ($, on) => {
  const log = stand(on)
  await prompt($, 'add rate limiting')
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'p1', todos: [{ content: 'Read the limiter', status: 'completed', activeForm: 'x' }, { content: 'Add the limit', status: 'in_progress', activeForm: 'x' }, { content: 'Run the tests', status: 'pending', activeForm: 'x' }] } as never)
  const sp = await $.ui.mount(site('Spinner', 'sp', { word: 'Working', message: null, suffix: '', mode: 'tool-use' }) as never)
  const d = await drawn(sp)
  expect(d).toContain('Add the limit 2/3')
  await sp.unmount()
  await $.command.run({ command: 'cockpit', args: 'focus off' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e1' } as never)
  const card = await $.ui.mount(site('ToolUse', 'e1', { tool_use_id: 'e1', tool: 'Edit', input: {}, isRunning: false, isErrored: false, isInterrupted: false }) as never)
  const before = log.opened
  await card.press({ key: 'card-e1' })
  expect(log.opened).toBe(before + 1)
  await card.unmount()
})
