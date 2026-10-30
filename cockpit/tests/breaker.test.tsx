import { expect, test } from 'claude-code/testing'
import { parseCases, parseReport, verifyState } from '../hooks/logic'

// Every feature driven end to end with the engine stood in: judges, testers, agents, files, commands, accounts, buttons
const scroll = { offset: 0, bodyRows: 60 }
const pane = (tab: string) => ({ plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll, view: {} } })
const band = { plugin: 'cockpit', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 90, scroll, view: {} } }
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

type Stubs = { votes?: number[]; score?: number; spawnFails?: boolean; noId?: boolean; denyAfter?: number; regDeny?: boolean; core?: 'allow' | 'ask' | 'deny'; hold?: boolean; noVerdict?: number }
function stand($: unknown, on: any, st: Stubs = {}) {
  const log = { toasts: [] as string[], spawned: [] as string[], prompts: [] as string[], registered: [] as string[], specs: [] as any[], ran: [] as string[][], store: {} as Record<string, unknown>, stopped: [] as string[], submitted: [] as string[], files: {} as Record<string, string>, list: [] as any[], open: () => {}, inFlight: Promise.resolve(), asked: 0, theme: 'dark' }
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
    if (String(e.system ?? '').includes('subagent definitions')) return { value: { isAnswered: true, text: 'Here: {"name": "API Guard", "description": "Checks API changes for breaking changes", "tools": ["Read", "Grep", "Nuke"], "prompt": "You check API changes. End with REPORT: and HANDOFF: lines."}', usage: { inputTokens: 1, outputTokens: 1 } } }
    if (String(e.prompt).startsWith('Break this task')) return { value: { isAnswered: true, text: '[{"step": "Read the limiter code", "kind": "Explore"}, {"step": "Add the rate limit", "kind": "Implement"}, {"step": "Run the tests", "kind": "Verify"}]', usage: { inputTokens: 1, outputTokens: 1 } } }
    const isScore = String(e.prompt).startsWith('Rate how complex')
    const text = isScore ? `{"score": ${st.score ?? 2}, "signals": ["small", "reversible"]}` : String(((st.votes ?? [1, 1, 1])[seat++ % (st.votes ?? [1]).length] ?? 0) + 1)
    return { value: { isAnswered: true, text, usage: { inputTokens: 1, outputTokens: 1 } } }
  })
  on('model.fork', async () => ({ value: { isAnswered: true, text: 'The task is small.', usage: { inputTokens: 1, outputTokens: 1 } } }))
  let spawns = 0
  let refused = 0
  on('fs.write', async (_: unknown, e: any) => ((log.files[e.path] = e.text), { value: undefined }))
  // The engine's own list of the session's agents
  on('agent.list', async () => ({ value: log.list }) as never)
  // The engine's own permission verdict for an Agent call; the spawn asks it as the Agent tool would
  on('tool.check', async (_: unknown, e: any) => ({ decision: e.tool === 'Agent' ? st.core ?? 'ask' : 'allow' }))
  // hold: the spawn waits, as the engine's does while it decides, until the test opens it
  const gate = new Promise<void>(res => (log.open = res))
  let flying = () => {}
  log.inFlight = new Promise<void>(res => (flying = res))
  on('agent.spawn', async (_: unknown, e: any) => {
    log.spawned.push(String(e.description))
    log.prompts.push(String(e.prompt))
    flying()
    if (st.hold) await gate
    if (st.noId) return { model: 'haiku' } as never
    // Auto mode's refusal of a start no request asked for, the first n times
    if (st.noVerdict && /^(Planner|Builder|Reviewer|Prover|Breaker|Scribe)$/.test(String(e.description)) && refused++ < st.noVerdict) return { deny: 'The server-side auto mode classifier gave no verdict for Agent: the request that produced this action did not ask for one.' }
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
  on('prompt.submit', async (_: unknown, e: any) => (e.origin?.kind === 'plugin' && log.submitted.push([String(e.text), ...(e.context ?? [])].join('\n')), { text: e.text }))
  return log
}


const done = ($: any, id: string, answer: string, isAborted = false) => $.turn.complete({ agentId: id, answer, reason: 'answer', turnId: id, isAborted, durationMs: 1 } as never)
const verify = ($: any) => $.command.run({ command: 'cockpit', args: 'test' } as never)
const agentsPane = { plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } }

// The engine's permission check of the Agent call a pane start raised, made while that spawn is in flight
async function checkDuringStart($: any, log: any) {
  const run = verify($)
  await log.inFlight
  const own = await $.tool.check({ tool: 'Agent', input: { subagent_type: 'cockpit:prover', prompt: log.prompts[0], description: 'Prover' } } as never)
  const other = await $.tool.check({ tool: 'Agent', input: { subagent_type: 'Explore', prompt: 'look around' } } as never)
  log.open()
  await run
  const after = await $.tool.check({ tool: 'Agent', input: { subagent_type: 'cockpit:prover', prompt: log.prompts[0], description: 'Prover' } } as never)
  return { own: own as any, other: other as any, after: after as any }
}

test('a start from the pane goes to the person where auto mode would judge it; the model\'s calls are untouched', async ($, on) => {
  const log = stand($, on, { hold: true })
  const c = await checkDuringStart($, log)
  expect(c.own.decision).toBe('ask')
  expect(c.own.reason).toContain('Cockpit pane')
  expect(c.own.reason).toContain('Prover')
  expect(c.other.reason).toBeUndefined()
  // Once started, the same call is the engine's again
  expect(c.after.reason).toBeUndefined()
})

test('a rule or mode that allows Agent calls lets a pane start run with no dialog', async ($, on) => {
  const log = stand($, on, { hold: true, core: 'allow' })
  expect((await checkDuringStart($, log)).own.decision).toBe('allow')
})

// An agent started as the model starts one (the kit hands a press-started spawn no id back, the engine does)
const modelSpawn = ($: any, type: string, task: string) =>
  $.agent.spawn({ tool_use_id: `m-${task}`, prompt: task, description: task, subagentType: type, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'x', background: true, fork: false } as never)

test('an agent that changes files gets a positive and a negative tester, and their results show on its row', async ($, on) => {
  const log = stand($, on)
  await modelSpawn($, 'cockpit:builder', 'add a rate limiter')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b', agentId: 'ag1' } as never)
  await done($, 'ag1', 'REPORT: added the limiter\nHANDOFF: try zero and negative limits')
  // The positive tester first, briefed with what the agent was asked and reported
  expect(log.spawned).toEqual(['add a rate limiter', 'Prover'])
  expect(log.prompts[1]).toContain('Builder (the agent whose work you are testing)')
  expect(log.prompts[1]).toContain('add a rate limiter')
  expect(log.prompts[1]).toContain('added the limiter')
  await done($, 'ag2', 'CASE PASS limits requests\nREPORT: works')
  // Then the negative tester, with the positive one's report as well
  expect(log.spawned).toEqual(['add a rate limiter', 'Prover', 'Breaker'])
  expect(log.prompts[2]).toContain('Prover:\nREPORT: works')
  await done($, 'ag3', 'CASE PASS zero limit\nCASE FAIL negative limit :: accepted\nREPORT: one hole')
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(agentsPane as never)
  const d = JSON.stringify(await ui.drawn())
  expect(d).toContain('+ positive 1/1')
  expect(d).toContain('− negative 1/2')
  expect(d).toContain("testing the Builder's work")
  // The testers' own runs are not tested again
  expect(log.spawned.length).toBe(3)
  await ui.unmount()
})

test('a run that only read files is tested when you press Test; the setting turns automatic testing off', async ($, on) => {
  const log = stand($, on)
  await modelSpawn($, 'cockpit:reviewer', 'review the diff')
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'ag1' } as never)
  await done($, 'ag1', 'REPORT: fine')
  expect(log.spawned).toEqual(['review the diff'])
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(agentsPane as never)
  await ui.press({ key: 'test-ag1' })
  expect(log.spawned).toEqual(['review the diff', 'Prover'])
  expect(log.prompts[1]).toContain('Reviewer (the agent whose work you are testing)')
  // Off: a run that changes files is left alone
  await ui.press({ key: 'testagents' })
  await ui.unmount()
  await modelSpawn($, 'Explore', 'write b')
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'x', agentId: 'ag3' } as never)
  await done($, 'ag3', 'REPORT: wrote b')
  expect(log.spawned).toEqual(['review the diff', 'Prover', 'write b'])
})

test('a start auto mode refuses for want of a request goes to Claude, and the agent Claude starts carries the pipeline on', async ($, on) => {
  // An agent's edit starts the testers at the turn's end; auto mode refuses the Prover's start from Cockpit
  const log = stand($, on, { noVerdict: 1 })
  await modelSpawn($, 'cockpit:builder', 'add a limiter')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b', agentId: 'ag1' } as never)
  await done($, 'ag1', 'REPORT: added it')
  await new Promise(res => (globalThis as any).setTimeout(res, 60))
  // Handed to Claude: a short line in the chat, the expert's brief as context; no error, the pipeline waits on the Prover
  expect(log.submitted.length).toBe(1)
  expect(log.submitted[0]).toMatch(/^▶ Start the Prover: run the cockpit:prover agent in the background; its brief is in \/repo\/\.cockpit\/handoffs\/cockpit-prover-\d+-\d+\.md$/)
  // The brief is in that file, whatever runs before Cockpit's own prompt hooks
  const brief = Object.entries(log.files).find(([p]) => p.includes('/handoffs/'))?.[1] ?? ''
  expect(brief).toContain('PRIOR REPORTS')
  expect(brief).toContain('added it')
  expect(log.toasts.join('|')).not.toContain('could not start')
  expect(log.toasts.join('|')).toContain('Starting the prover…')
  expect(log.toasts.join('|')).not.toContain('Auto mode')
  // The hand-off is no task of the person's: no flow opened
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ui = await $.ui.mount(agentsPane as never)
  expect(JSON.stringify(await ui.drawn())).toContain('No task yet')
  await ui.unmount()
  // Claude starts it: the waiting step takes it, and its answer hands on to the Breaker
  await modelSpawn($, 'cockpit:prover', 'the brief')
  await done($, 'ag2', 'CASE PASS works\nREPORT: fine')
  expect(log.spawned.filter(x => x === 'Breaker').length).toBe(1)
})

const run = ($: any, args: string) => $.command.run({ command: 'cockpit', args: `run ${args}` } as never)

test('several agents run at once with one task, and Stop all and Clear finished manage them', async ($, on) => {
  const log = stand($, on)
  await run($, 'planner reviewer -- review the login flow')
  expect(log.spawned).toEqual(['Planner', 'Reviewer'])
  expect(log.prompts.every(p => p.startsWith('Task: review the login flow'))).toBe(true)
  // Two copies of one agent run side by side
  await run($, 'planner')
  const ui = await $.ui.mount(agentsPane as never)
  let d = JSON.stringify(await ui.drawn())
  expect(d).toContain('3 running · 0 done · 3 total')
  expect(d).toContain('2 running · ')
  await ui.press({ key: 'stop-all' })
  expect(log.stopped.sort()).toEqual(['ag1', 'ag2', 'ag3'])
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('0 running · 0 done · 3 total')
  await ui.press({ key: 'clear-finished' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('3 total')
  await ui.unmount()
})

test('ticked agents run together from the run bar', async ($, on) => {
  const log = stand($, on)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(agentsPane as never)
  expect(JSON.stringify(await ui.drawn())).not.toContain('run-selected')
  await ui.press({ key: 'pick-cockpit:planner' })
  await ui.press({ key: 'pick-cockpit:scribe' })
  expect(JSON.stringify(await ui.drawn())).toContain('2 selected · run them at once')
  await (ui as any).input({ key: 'run-task', text: 'tidy the docs', kind: 'change' })
  await ui.press({ key: 'run-selected' })
  expect(log.spawned).toEqual(['Planner', 'Scribe'])
  expect(log.prompts.every(p => p.startsWith('Task: tidy the docs'))).toBe(true)
  // The ticks clear once they have started
  expect(JSON.stringify(await ui.drawn())).not.toContain('selected · run them at once')
  await ui.unmount()
})

test('a batch auto mode refuses goes to Claude in one line', async ($, on) => {
  const log = stand($, on, { noVerdict: 2 })
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(agentsPane as never)
  await ui.press({ key: 'pick-cockpit:planner' })
  await ui.press({ key: 'pick-cockpit:reviewer' })
  await ui.press({ key: 'run-selected' })
  await ui.unmount()
  await new Promise(res => (globalThis as any).setTimeout(res, 80))
  expect(log.submitted.length).toBe(1)
  expect(log.submitted[0]).toContain('▶ Start 2 agents: run each in the background, all at once')
  expect(log.submitted[0]).toContain('- cockpit:planner: brief in /repo/.cockpit/handoffs/')
  expect(log.submitted[0]).toContain('- cockpit:reviewer: brief in /repo/.cockpit/handoffs/')
  expect(log.toasts).toContain('◆ Starting 2 agents…')
})

test('subagents Claude starts show in the Agents tab from the engine\'s list, and settle when they end', async ($, on) => {
  const log = stand($, on)
  log.list.push({ id: 'x1', description: 'scan the repo', type: 'Explore', status: 'running' }, { id: 'x2', description: 'write the docs', type: 'general-purpose', status: 'running' })
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(agentsPane as never)
  let d = JSON.stringify(await ui.drawn())
  expect(d).toContain('2 running · 0 done · 2 total')
  expect(d).toContain('scan the repo')
  expect(d).toContain('write the docs')
  // One ends without Cockpit hearing it: the list settles it at the turn's end
  log.list[0].status = 'completed'
  await $.turn.complete({ answer: 'ok', reason: 'answer', turnId: 'm', isAborted: false, durationMs: 1 } as never)
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('1 running · 1 done · 2 total')
  await ui.unmount()
})

test('an agent runs again with your instructions, from its team row or from a finished run', async ($, on) => {
  const log = stand($, on)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(agentsPane as never)
  await ui.press({ key: 'edit-cockpit:planner' })
  await (ui as any).input({ key: 'rerun-input', text: 'plan the auth refactor', kind: 'change' })
  await ui.press({ key: 'rerun-go' })
  expect(log.spawned).toEqual(['Planner'])
  expect(log.prompts[0]).toContain('Task: plan the auth refactor')
  await ui.unmount()
  // A finished run, again with more said
  await run($, 'reviewer -- review the login')
  // (the press's Planner took ag1 in the stand; the kit hands a press-started spawn no id back)
  await done($, 'ag2', 'REPORT: fine')
  const ui2 = await $.ui.mount(agentsPane as never)
  await ui2.press({ key: 'redo-ag2' })
  await (ui2 as any).input({ key: 'rerun-input', text: 'focus on the error paths', kind: 'change' })
  await ui2.press({ key: 'rerun-go' })
  expect(log.prompts[log.prompts.length - 1]).toContain('Task: review the login\n\nInstructions for this run: focus on the error paths')
  await ui2.unmount()
})

test('a pipeline started before any prompt leaves progress at 0%, Ready', async ($, on) => {
  stand($, on)
  await verify($)
  await done($, 'ag1', 'REPORT: ok')
  const b = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 90, scroll: { offset: 0, bodyRows: 60 }, view: {} } } as never)
  const d = JSON.stringify(await b.drawn())
  expect(d).toContain('"0%"')
  expect(d).toContain(' Ready')
  expect(d).not.toContain('80%')
  await b.unmount()
})

test('an agent whose run ends on an error shows as failed', async ($, on) => {
  stand($, on)
  await verify($)
  await $.turn.complete({ agentId: 'ag1', answer: '', reason: 'error', turnId: 'ag1', isAborted: false, durationMs: 1 } as never)
  const ui = await $.ui.mount(agentsPane as never)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  expect(JSON.stringify(await ui.drawn())).toContain('"Failed"')
  await ui.unmount()
})

test('an agent made from a description joins the team, runs from its card, and is kept for later sessions', async ($, on) => {
  const log = stand($, on)
  on('command.register', async () => ({ value: {} }) as never)
  on('clock.every', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(agentsPane as never)
  await ui.press({ key: 'spawn-toggle' })
  // Typed and sent with Enter: the form makes the agent and closes
  await (ui as any).input({ key: 'describe', text: 'check API changes for breaking changes' })
  const spec = log.specs.find(x => x.name === 'api-guard')
  expect(spec.tools).toEqual(['Read', 'Grep'])
  expect(log.store.agents).toEqual([spec])
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Api Guard')
  expect(drawn).toContain('Checks API changes for breaking changes')
  await ui.press({ key: 'run-cockpit:api-guard' })
  expect(log.spawned).toContain('Api Guard')
  await ui.unmount()
  // A later session registers it again from the store
  log.specs.length = 0
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await new Promise(res => (globalThis as any).setTimeout(res, 400))
  expect(log.specs.some(x => x.name === 'api-guard')).toBe(true)
})

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
