import { expect, test } from 'claude-code/testing'
import { parseCases, parseReport, verifyState } from '../hooks/logic'

// Every feature driven end to end with the engine stood in: judges, testers, agents, files, commands, accounts, buttons
const scroll = { offset: 0, bodyRows: 60 }
const pane = (tab: string) => ({ plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll, view: {} } })
const band = { plugin: 'cockpit', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 90, scroll, view: {} } }
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

type Stubs = { votes?: number[]; score?: number; spawnFails?: boolean; noId?: boolean; denyAfter?: number; regDeny?: boolean }
function stand($: unknown, on: any, st: Stubs = {}) {
  const log = { toasts: [] as string[], spawned: [] as string[], prompts: [] as string[], registered: [] as string[], specs: [] as any[], ran: [] as string[][], store: {} as Record<string, unknown>, stopped: [] as string[], asked: 0, theme: 'dark' }
  let seat = 0
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('agent.register', async (_: unknown, e: any) => (log.registered.push(String(e.name)), log.specs.push(e), st.regDeny ? { deny: 'x' } : { value: { agent: `cockpit:${e.name}` } }))
  on('ui.toast', async (_: unknown, e: any) => (log.toasts.push(String(e.text)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_: unknown, e: any) => {
    const a = Object.values(e as object).find(Array.isArray) as string[]
    log.ran.push(a)
    const cmd = a.join(' ')
    if (cmd.startsWith('git status')) return ok('## master\0 M a.txt\0')
    if (cmd.startsWith('git config --global user.name')) return ok('Dev\n')
    if (cmd.startsWith('git config --global user.email')) return ok('dev@x.io\n')
    if (cmd.startsWith('gh auth status')) return ok('github.com\n  ✓ Logged in to github.com account one (keyring)\n  - Active account: false\n\n  ✓ Logged in to github.com account two (keyring)\n  - Active account: true\n')
    if (cmd.startsWith('git rev-parse')) return ok('abc1234\n')
    return ok('')
  })
  on('store.get', async (_: unknown, e: any) => ({ value: log.store[e.key] }))
  on('store.set', async (_: unknown, e: any) => ((log.store[e.key] = e.value), { value: undefined }))
  on('config.list', async () => ({ value: [{ key: 'theme', value: log.theme }] }))
  on('config.set', async (_: unknown, e: any) => ({ value: e.value }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 50000, percent: 25, breakdown: { categories: [{ name: 'Messages', tokens: 30000 }, { name: 'System prompt', tokens: 20000 }], totalTokens: 50000 } }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('model.complete', async (_: unknown, e: any) => {
    const isScore = String(e.prompt).startsWith('Rate how complex')
    const text = isScore ? `{"score": ${st.score ?? 2}, "signals": ["small", "reversible"]}` : String(((st.votes ?? [1, 1, 1])[seat++ % (st.votes ?? [1]).length] ?? 0) + 1)
    return { value: { isAnswered: true, text, usage: { inputTokens: 1, outputTokens: 1 } } }
  })
  on('model.fork', async () => ({ value: { isAnswered: true, text: 'The task is small.', usage: { inputTokens: 1, outputTokens: 1 } } }))
  let spawns = 0
  on('agent.spawn', async (_: unknown, e: any) => {
    log.spawned.push(String(e.description))
    log.prompts.push(String(e.prompt))
    if (st.noId) return { model: 'haiku' } as never
    if (st.denyAfter !== undefined && spawns >= st.denyAfter) return { deny: 'nope' }
    return st.spawnFails ? { deny: 'no agents here' } : { model: 'haiku', agentId: `ag${++spawns}` }
  })
  // The person answering a question: the second option
  on('tool.call', async (_: unknown, e: any) => {
    if (e.tool === 'TaskStop') log.stopped.push(String(e.task_id))
    if (e.tool === 'AskUserQuestion') return (log.asked++, { result: { questions: e.questions, answers: Object.fromEntries(e.questions.map((q: any) => [q.question, q.options[1]?.label ?? ''])) } })
    return { result: 'ok' }
  })
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  return log
}


const done = ($: any, id: string, answer: string, isAborted = false) => $.turn.complete({ agentId: id, answer, reason: 'answer', turnId: id, isAborted, durationMs: 1 } as never)
const verify = ($: any) => $.command.run({ command: 'cockpit', args: 'test' } as never)

test('aborted pipeline agent', async ($, on) => {
  const log = stand($, on)
  await verify($)
  await done($, 'ag1', 'CASE PASS a\nREPORT: r', true)
  expect(log.spawned).toEqual(['Prover'])
})

test('unknown agent id does not advance', async ($, on) => {
  const log = stand($, on)
  await verify($)
  await done($, 'nope', 'REPORT: x')
  expect(log.spawned).toEqual(['Prover'])
})

test('second pipeline while one runs is refused', async ($, on) => {
  const log = stand($, on)
  await verify($)
  await verify($)
  expect(log.spawned).toEqual(['Prover'])
  expect(log.toasts.join('|')).toContain('still running')
})

test('two simultaneous starts spawn once', async ($, on) => {
  const log = stand($, on)
  await Promise.all([verify($), verify($)])
  expect(log.spawned).toEqual(['Prover'])
})

test('Stop on the pipeline agent ends the pipeline; late turn.complete does not advance', async ($, on) => {
  const log = stand($, on)
  await verify($)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane('agents') as never)
  await ui.press({ key: 'stop-ag1' })
  await done($, 'ag1', 'REPORT: late')
  expect(log.stopped).toEqual(['ag1'])
  expect(log.spawned).toEqual(['Prover'])
  await verify($)
  expect(log.spawned).toEqual(['Prover', 'Prover'])
})

test('refused spawn on first step clears pipeline so a retry works', async ($, on) => {
  const log = stand($, on, { spawnFails: true })
  await verify($)
  await verify($)
  expect(log.toasts.filter(t => /could not start/i.test(t)).length).toBe(2)
})

test('spawn that returns no id and no spawn event leaves the pipeline stuck', async ($, on) => {
  const log = stand($, on, { noId: true })
  await verify($)
  await verify($)
  expect(log.toasts.join('|')).not.toContain('still running')
})

test('refused spawn on second step ends pipeline', async ($, on) => {
  const log = stand($, on, { denyAfter: 1 })
  await verify($)
  await done($, 'ag1', 'CASE PASS a\nREPORT: r')
  await verify($)
  expect(log.toasts.join('|')).not.toContain('still running')
})

test('answer without REPORT/HANDOFF still hands something on; odd CASE lines parse', async ($, on) => {
  const log = stand($, on)
  await verify($)
  await done($, 'ag1', 'case pass   lower :: x\n  CASE  FAIL  spaced  \nCASE PASS\nCASE FAIL a :: b :: c\nplain text no report')
  expect(log.prompts[1]).toContain('plain text no report')
  const c = parseCases('case pass   lower :: x\n  CASE  FAIL  spaced  \nCASE PASS\nCASE FAIL a :: b :: c\nCASE PASS 日本語 :: ✓')
  expect(c.map(x => x.n)).toEqual(['lower', 'spaced', 'a', '日本語'])
  expect(parseReport('Report: lower\nhandoff: h')).toBe('REPORT: lower\nHANDOFF: h')
  expect(parseReport('REPORT : spaced')).toBe('REPORT : spaced')
  expect(parseReport('')).toBe('')
  expect(parseReport('x'.repeat(1e6)).length).toBe(1e6)
})

const boot = async ($: any, on: any, files: Record<string, string>, regDeny = false) => {
  const log = stand($, on, { regDeny })
  const specs = log.specs
  on('fs.list', async (_: unknown, e: any) => ({ value: String(e.path).endsWith('/agents') ? Object.keys(files).map(n => ({ name: n, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) : [] }))
  on('fs.read', async (_: unknown, e: any) => { const f = files[String(e.path).split('/').pop()!]; if (f === undefined) throw new Error('EACCES'); return { value: f } })
  on('command.register', async () => ({ value: {} }) as never)
  on('clock.every', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  const r = await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch((e: any) => ({ err: String(e) }))
  await new Promise(res => (globalThis as any).setTimeout(res, 400))
  return { specs, log, r }
}

test('agents md without frontmatter, CRLF, empty tools, colonless line', async ($, on) => {
  const { specs } = await boot($, on, {
    'a.md': 'no frontmatter at all',
    'b.md': '---\r\nname: b\r\ndescription: d\r\n---\r\nbody',
    'c.md': '---\nname: c\ndescription: d\ntools:\n---\nbody',
    'd.md': '---\nname: d\ngarbage line\ndescription: x\n---\nbody',
    'e.md': '---\n---\nbody',
    'f.md': '---\nname: f\ndescription: d\ntools: Read,, Bash\n---\nbody',
    'g.md': '---\nname: g\n---\nbody',
  })
  expect(specs.map(s => s.name).sort()).toEqual(['c', 'd', 'f', 'g'])
  expect(specs.find(s => s.name === 'c').tools).toBeUndefined()
  expect(specs.find(s => s.name === 'f').tools).toEqual(['Read', 'Bash'])
})

test('registerExperts survives a failing register and unreadable files', async ($, on) => {
  const { r, specs } = await boot($, on, { 'z.md': '---\nname: z\ndescription: d\n---\nb', 'bad.md': undefined as never }, true)
  expect(JSON.stringify(r)).not.toContain('err')
  expect(specs.length).toBe(1)
})

test('verifyState with only the Prover run is not passed; stopped agents not passed', async () => {
  const a = (type: string, status: string, cases: any[]) => ({ type, status, cases }) as never
  expect(verifyState([a('cockpit:prover', 'done', [{ n: 'a', st: 'pass' }])]).passed).toBe(false)
  expect(verifyState([a('cockpit:breaker', 'done', [{ n: 'a', st: 'pass' }])]).passed).toBe(false)
  expect(verifyState([a('cockpit:prover', 'stopped', [{ n: 'a', st: 'pass' }]), a('cockpit:breaker', 'done', [{ n: 'b', st: 'pass' }])]).passed).toBe(false)
  expect(verifyState([a('cockpit:prover', 'done', [{ n: 'a', st: 'fixed' }]), a('cockpit:breaker', 'done', [{ n: 'b', st: 'pass' }])]).fail).toBe(0)
})
