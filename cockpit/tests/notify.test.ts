import { expect, test } from 'claude-code/testing'
import { openMore, deskPane as pane } from './more'
import { doneText } from '../hooks/core/notify'

// The cases no session below drives: a turn with files and tests, a tester's count, a failure, a worktree to bring
// back, how an autopilot run ended, and a long task
test("each kind of finish says what finished and how it went", () => {
  expect(doneText({ kind: 'turn', task: 'fix the login', files: 3, add: 40, del: 12, tests: { pass: 3, total: 3 } })).toEqual({ title: 'Claude is done', text: 'fix the login · 3 files +40 −12 · tests 3/3' })
  const agent = { name: 'Reviewer', status: 'done' as const, report: 'REPORT: Two findings, none blocking\nHANDOFF: nothing', cases: [], worktree: undefined }
  expect(doneText({ kind: 'agent', agent: { ...agent, name: 'Prover', cases: [{ n: 'a', st: 'pass' }, { n: 'b', st: 'fail' }] as never } }).text).toBe('1/2 passed')
  expect(doneText({ kind: 'agent', agent: { ...agent, status: 'failed' as const, report: '' } })).toEqual({ title: 'Reviewer failed', text: 'failed' })
  // A worktree agent with work to bring back says so; once brought back, it does not
  const wt = { path: '/w', branch: 'cockpit/x', base: 'b', files: ['a.ts', 'b.ts'], add: 9, del: 2 }
  expect(doneText({ kind: 'agent', agent: { ...agent, report: 'Refactored', worktree: wt } }).text).toBe('Refactored · Bring back ready: 2 files +9 −2')
  expect(doneText({ kind: 'agent', agent: { ...agent, report: 'Refactored', worktree: { ...wt, back: true } } }).text).toBe('Refactored')
  expect(doneText({ kind: 'cycle', cycle: 6, ticked: 5, total: 5, spent: 2, ended: 'done' }).title).toBe('Autopilot done after cycle 6')
  expect(doneText({ kind: 'cycle', cycle: 3, ticked: 1, total: 5, spent: 2, ended: 'paused' }).title).toBe('Autopilot paused after cycle 3')
  // A long task is cut to one line
  expect(doneText({ kind: 'turn', task: 'x'.repeat(300), files: 0, add: 0, del: 0 }).text.length).toBe(120)
})

// A session that records every notice; watching: the Cockpit pane open and focused
function stand(on: any, opt: { watching?: () => boolean } = {}) {
  const log = { notices: [] as { title?: string; text: string }[], ids: [] as { id: string; type: string }[] }
  on('clock.now', async () => ({ value: 1_700_000_000_000 }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: opt.watching?.() ? [{ id: 'cockpit', title: 'Cockpit', isShown: true, isFocused: false, isPlaced: true }] : [] }) as never)
  on('ui.notify', async (_: unknown, e: any) => (log.notices.push({ title: e.title, text: String(e.text) }), { value: { isSent: true, channel: 'terminal' } }) as never)
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('tool.call', async () => ({ result: 'ok' }))
  on('tool.check', async () => ({ decision: 'allow' }) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  on('fs.list', async () => ({ value: [] }) as never)
  let n = 0
  on('agent.spawn', async (_: unknown, e: any) => {
    const id = `ag${++n}`
    log.ids.push({ id, type: String(e.subagentType ?? e.subagent_type) })
    return { model: 'haiku', agentId: id }
  })
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (e.argv as string[]).join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out('## main\0')
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    return out('', cmd.startsWith('git rev-parse --verify') ? 1 : 0)
  })
  return log
}
const prompt = async ($: any, text: string) => {
  await $.prompt.submit({ text, command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text, turnId: `t-${text}` } as never).catch(() => null)
}
const turnDone = ($: any, turnId: string) => $.turn.complete({ answer: 'ok', reason: 'answer', turnId, isAborted: false, durationMs: 1000 } as never)
const agentDone = ($: any, agentId: string, answer: string) => $.turn.complete({ agentId, answer, reason: 'answer', turnId: agentId, isAborted: false, durationMs: 1000 } as never)

test('a turn, a background agent and a pipeline each tell you once when they finish, and nothing while you watch', { timeoutMs: 20_000 }, async ($, on) => {
  let watching = false
  const log = stand(on, { watching: () => watching })
  // The main turn
  await prompt($, 'fix the login')
  await turnDone($, 't-fix the login')
  expect(log.notices).toEqual([{ title: 'Claude is done', text: 'fix the login · no files changed' }])
  // The same finish again: no second notice
  await turnDone($, 't-fix the login')
  expect(log.notices.length).toBe(1)
  // A background agent you started (not a pipeline's step)
  await $.agent.spawn({ tool_use_id: 'a', prompt: 'review it', description: 'review it', subagentType: 'cockpit:reviewer', provider: { plugin: 'cockpit', tier: 'user' }, parentModel: 'x', background: true, fork: false } as never)
  await agentDone($, 'ag1', 'REPORT: two findings, none blocking')
  expect(log.notices.at(-1)).toEqual({ title: 'Reviewer finished', text: 'two findings, none blocking' })
  // A pipeline: Verify, its two testers, each finished by the id its start got; one notice for the pipeline, none for its steps
  const before = log.notices.length
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  const prover = log.ids.filter(x => x.type === 'cockpit:prover').at(-1)!.id
  await agentDone($, prover, 'CASE PASS login works :: ok')
  const breaker = log.ids.filter(x => x.type === 'cockpit:breaker').at(-1)!.id
  await agentDone($, breaker, 'CASE FAIL empty password :: crashes')
  const pipeline = log.notices.slice(before)
  expect(pipeline).toEqual([{ title: 'Verify finished', text: 'Failed: empty password' }])
  // A second Verify whose testers both pass: passed, whatever an older run's testers found
  const before2 = log.notices.length
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  await agentDone($, log.ids.filter(x => x.type === 'cockpit:prover').at(-1)!.id, 'CASE PASS login works :: ok')
  await agentDone($, log.ids.filter(x => x.type === 'cockpit:breaker').at(-1)!.id, 'CASE PASS empty password :: refused')
  expect(log.notices.slice(before2)).toEqual([{ title: 'Verify finished', text: 'All checks passed' }])
  // Watching the pane (on screen, even with the keyboard in the prompt): quiet
  watching = true
  const before3 = log.notices.length
  await prompt($, 'and the signup')
  await turnDone($, 't-and the signup')
  expect(log.notices.length).toBe(before3)
})

test('Tell me when work is done can be turned off in the Agents settings, and on again', async ($, on) => {
  const log = stand(on)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await openMore(ui)
  await ui.press({ key: 'fold-settings' })
  expect(JSON.stringify(await ui.drawn())).toContain('Tell me when work is done')
  await ui.press({ key: 'notify-done' })
  await prompt($, 'quiet one')
  await turnDone($, 't-quiet one')
  expect(log.notices).toEqual([])
  await ui.press({ key: 'notify-done' })
  await prompt($, 'loud one')
  await turnDone($, 't-loud one')
  expect(log.notices.map(x => x.title)).toEqual(['Claude is done'])
  await ui.unmount()
})

test('agents started together tell you once, when the last is done; a stopped one tells you nothing', async ($, on) => {
  const log = stand(on)
  const spawn = (id: string, type: string) => $.agent.spawn({ tool_use_id: id, prompt: id, description: id, subagentType: type, provider: { plugin: 'cockpit', tier: 'user' }, parentModel: 'x', background: true, fork: false } as never)
  await spawn('r', 'cockpit:reviewer')
  await spawn('s', 'cockpit:scribe')
  await spawn('p', 'cockpit:planner')
  await agentDone($, 'ag1', 'REPORT: two findings')
  await agentDone($, 'ag2', 'REPORT: docs updated')
  expect(log.notices).toEqual([])
  await agentDone($, 'ag3', 'REPORT: three steps')
  expect(log.notices).toEqual([{ title: '3 agents finished', text: 'Reviewer: two findings · Scribe: docs updated · Planner: three steps' }])
  // Stopped by you: no notice
  await spawn('b', 'cockpit:builder')
  await $.turn.complete({ agentId: 'ag4', answer: '', reason: 'answer', turnId: 'ag4', isAborted: true, durationMs: 10 } as never)
  expect(log.notices.length).toBe(1)
})
