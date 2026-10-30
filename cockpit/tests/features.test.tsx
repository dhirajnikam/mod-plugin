import { expect, test } from 'claude-code/testing'

// Every feature driven end to end with the engine stood in: judges, testers, agents, files, commands, accounts, buttons
const scroll = { offset: 0, bodyRows: 60 }
const pane = (tab: string) => ({ plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll, view: {} } })
const band = { plugin: 'cockpit', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 90, scroll, view: {} } }
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

type Stubs = { votes?: number[]; score?: number; spawnFails?: boolean; noSteps?: boolean; clearFails?: boolean }
function stand($: unknown, on: any, st: Stubs = {}) {
  const log = { toasts: [] as string[], spawned: [] as string[], prompts: [] as string[], registered: [] as string[], ran: [] as string[][], store: {} as Record<string, unknown>, stopped: [] as string[], submitted: [] as string[], notes: [] as string[], commands: [] as string[], compacted: 0, scored: 0, asked: 0, theme: 'dark' }
  let seat = 0
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('agent.register', async (_: unknown, e: any) => (log.registered.push(String(e.name)), { value: { agent: `cockpit:${e.name}` } }))
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
    if (cmd.startsWith('git ls-files')) return ok('README.md\0docs/guide.md\0src/app.ts\0')
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
    if (String(e.prompt).startsWith('Break this task') && st.noSteps) return { value: { isAnswered: false, reason: 'empty-reply' } } as never
    if (String(e.prompt).startsWith('Break this task')) return { value: { isAnswered: true, text: '[{"step": "Read the limiter code", "kind": "Explore"}, {"step": "Add the rate limit", "kind": "Implement"}, {"step": "Run the tests", "kind": "Verify"}]', usage: { inputTokens: 1, outputTokens: 1 } } }
    const isScore = String(e.prompt).startsWith('Rate how complex')
    if (isScore) log.scored++
    const text = isScore ? `{"score": ${st.score ?? 2}, "signals": ["small", "reversible"]}` : String(((st.votes ?? [1, 1, 1])[seat++ % (st.votes ?? [1]).length] ?? 0) + 1)
    return { value: { isAnswered: true, text, usage: { inputTokens: 1, outputTokens: 1 } } }
  })
  on('model.fork', async () => ({ value: { isAnswered: true, text: 'The task is small.', usage: { inputTokens: 1, outputTokens: 1 } } }))
  let spawns = 0
  on('agent.spawn', async (_: unknown, e: any) => {
    log.spawned.push(String(e.description))
    log.prompts.push(String(e.prompt))
    return st.spawnFails ? { deny: 'no agents here' } : { model: 'haiku', agentId: `ag${++spawns}` }
  })
  // The person answering a question: the second option
  on('tool.call', async (_: unknown, e: any) => {
    if (e.tool === 'TaskStop') log.stopped.push(String(e.task_id))
    if (e.tool === 'AskUserQuestion') return (log.asked++, { result: { questions: e.questions, answers: Object.fromEntries(e.questions.map((q: any) => [q.question, q.options[1]?.label ?? ''])) } })
    return { result: 'ok' }
  })
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async (_: unknown, e: any) => {
    if (st.clearFails && e.command === 'clear') throw new Error('a turn is running')
    return (log.commands.push(String(e.command)), { text: '' })
  })
  on('session.compact', async () => (log.compacted++, { skip: 'the stand keeps the conversation' }) as never)
  on('prompt.submit', async (_: unknown, e: any) => (e.origin?.kind === 'plugin' && log.submitted.push(String(e.text)), { text: e.text }))
  on('session.append', async (_: unknown, e: any, next: any) => (log.notes.push(JSON.stringify(e.message?.content ?? '')), next(e)))
  return log
}

test('judges decide a simple question for you, and a split goes to you', async ($, on) => {
  const log = stand($, on, { votes: [0, 0, 0], score: 2 })
  const q = { question: 'Which lib?', options: [{ label: 'date-fns' }, { label: 'dayjs' }], multiSelect: false, header: 'lib' }
  const r = (await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 't1', questions: [q] } as never)) as any
  expect(r.result?.answers?.['Which lib?']).toBe('date-fns')
  expect(log.toasts.some(t => t.includes('Judge 3/3 · date-fns'))).toBe(true)
  const ui = await $.ui.mount(pane('overview') as never)
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Which lib?')
  expect(drawn).toContain('3/3 → date-fns')
  await ui.unmount()
})

test('a split vote asks you instead', async ($, on) => {
  const log = stand($, on, { votes: [0, 1, 0, 1, 0, 1], score: 5 })
  const q = { question: 'Which lib?', options: [{ label: 'date-fns' }, { label: 'dayjs' }], multiSelect: false, header: 'lib' }
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 't2', questions: [q] } as never)
  expect(log.asked).toBe(1)
  expect(log.toasts.some(t => t.includes('Judges split'))).toBe(true)
  const ui = await $.ui.mount(pane('overview') as never)
  expect(JSON.stringify(await ui.drawn())).toContain('You chose · dayjs')
  await ui.unmount()
})

const settle = () => new Promise(res => (globalThis as any).setTimeout(res, 150))
const nextStep = ($: any, ask: string, actions: object[]) => $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', tool_use_id: `w-${ask}`, recap: 'Done.', ask, actions } as never)
const replies = [{ label: 'Keep going', message: 'Yes, keep going with the next step.' }, { label: 'Stop here', message: 'Stop here.' }]

test('Ask me sends every question to you with the judges\' advice; Off runs no judges at all', async ($, on) => {
  const log = stand($, on, { votes: [0, 0, 0] })
  await $.command.run({ command: 'cockpit', args: 'mode ask' } as never)
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 't3', questions: [{ question: 'Q?', options: [{ label: 'a' }, { label: 'b' }], multiSelect: false, header: 'q' }] } as never)
  await settle()
  // You answered (the stand picks b); the judges' pick is kept beside it as advice
  expect(log.asked).toBe(1)
  expect(log.toasts).toContain('◆ Judges recommend "a" · 3/3')
  const ui = await $.ui.mount(pane('overview') as never)
  const d = JSON.stringify(await ui.drawn())
  expect(d).toContain('You chose · b · Judges recommend')
  await ui.unmount()
  await $.command.run({ command: 'cockpit', args: 'mode off' } as never)
  const scored = log.scored
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 't4', questions: [{ question: 'R?', options: [{ label: 'a' }, { label: 'b' }], multiSelect: false, header: 'r' }] } as never)
  await nextStep($, 'Keep going?', replies)
  await settle()
  expect(log.asked).toBe(2)
  expect(log.scored).toBe(scored)
  expect(log.submitted).toEqual([])
})

test('in Auto the judges answer a next-step question by sending the winning reply; a risky one only gets advice', async ($, on) => {
  const log = stand($, on, { votes: [0, 0, 0] })
  await nextStep($, 'Keep going?', replies)
  await settle()
  expect(log.submitted).toEqual(['Yes, keep going with the next step.'])
  expect(log.notes.join()).toContain('Judges chose')
  // Hard to undo: advice in the chat and above the prompt, nothing sent
  await nextStep($, 'Make the repo public now?', [{ label: 'Make it public', message: 'Make it public.' }, { label: 'Keep it private' }])
  await settle()
  expect(log.submitted.length).toBe(1)
  expect(log.notes.join()).toContain('it is hard to undo, so it is yours to decide')
  await $.command.run({ command: 'cockpit', args: 'focus off' } as never)
  const b = await $.ui.mount(band as never)
  expect(JSON.stringify(await b.drawn())).toContain('Judges recommend \\"Make it public\\"')
  await b.unmount()
})

test('the judges answer at most three next steps in a row; your own prompt starts the count again', async ($, on) => {
  const log = stand($, on, { votes: [0, 0, 0] })
  for (const n of [1, 2, 3, 4]) {
    await nextStep($, `Step ${n}?`, replies)
    await settle()
  }
  expect(log.submitted.length).toBe(3)
  expect(log.notes.join()).toContain('three were answered in a row')
  await $.prompt.submit({ text: 'carry on', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await nextStep($, 'Step 5?', replies)
  await settle()
  expect(log.submitted.length).toBe(4)
})

test('the Verify pipeline runs the Prover then the Breaker, handing the report along; cases fill the Agents tab and the band', async ($, on) => {
  const log = stand($, on)
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  expect(log.spawned).toEqual(['Prover'])
  expect(log.prompts[0]).toContain('(none: you are first)')
  let ag = await $.ui.mount(pane('agents') as never)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  let drawn = JSON.stringify(await ag.drawn())
  expect(drawn).toContain('Prover')
  expect(drawn).toContain('cockpit:prover')
  await ag.unmount()
  await $.turn.complete({ agentId: 'ag1', answer: 'CASE PASS login works\nCASE PASS logout works\nREPORT: both paths pass\nHANDOFF: try empty passwords', reason: 'answer', turnId: 'x', isAborted: false, durationMs: 1000 } as never)
  // The Breaker starts with the Prover's report in its brief
  expect(log.spawned).toEqual(['Prover', 'Breaker'])
  expect(log.prompts[1]).toContain('PRIOR REPORTS')
  expect(log.prompts[1]).toContain('REPORT: both paths pass')
  expect(log.prompts[1]).toContain('HANDOFF: try empty passwords')
  await $.turn.complete({ agentId: 'ag2', answer: 'CASE FAIL empty password :: got 200\nREPORT: one hole', reason: 'answer', turnId: 'y', isAborted: false, durationMs: 1000 } as never)
  expect(log.toasts.filter(t => /prover|breaker|pipeline/i.test(t))).toEqual(['◆ Started the prover', '◆ Prover: 2/2 passed', '◆ Started the breaker', '◆ Breaker: 0/1 passed · 1 failing', '◆ Verify pipeline done'])
  ag = await $.ui.mount(pane('agents') as never)
  drawn = JSON.stringify(await ag.drawn())
  expect(drawn).toContain('empty password')
  expect(drawn).toContain('got 200')
  // Passing cases fold into the expert's row; failing ones stay in view under the run
  expect(drawn).toContain('2/2 passed')
  expect(drawn).toContain('   ✗ ')
  await ag.unmount()
  await $.command.run({ command: 'cockpit', args: 'focus on' } as never)
  const b = await $.ui.mount(band as never)
  expect(JSON.stringify(await b.drawn())).toContain('tests 2/3')
  await b.unmount()
})

test('the six experts register from the agents folder at session start', async ($, on) => {
  const log = stand($, on)
  const names = ['planner', 'builder', 'reviewer', 'prover', 'breaker', 'scribe']
  on('fs.list', async (_: unknown, e: any) => ({ value: String(e.path).endsWith('/agents') ? names.map(n => ({ name: `${n}.md`, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) : [] }))
  on('fs.read', async (_: unknown, e: any) => ({ value: `---\nname: ${String(e.path).split('/').pop()?.slice(0, -3)}\ndescription: an expert\nmodel: sonnet\ntools: Read, Bash\n---\nYou are an expert.` }))
  on('command.register', async () => ({ value: {} }) as never)
  on('clock.every', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  const r = await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(e => ({ err: String(e) }))
  expect(JSON.stringify(r)).not.toContain('err')
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  expect(log.registered.sort()).toEqual(['breaker', 'builder', 'planner', 'prover', 'reviewer', 'scribe'])
})

test('a tester that cannot start says so', async ($, on) => {
  const log = stand($, on, { spawnFails: true })
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  expect(log.toasts.some(t => t.includes('could not start: no agents here'))).toBe(true)
})

test('subagents show in the Agents tab with their tool calls, and Stop stops them', async ($, on) => {
  const log = stand($, on)
  await $.agent.spawn({ tool_use_id: 'a1', prompt: 'look around', description: 'look around', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'x', background: false, fork: false } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/README.md', agentId: 'ag1' } as never)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane('agents') as never)
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('1 running')
  expect(drawn).toContain('1 total')
  expect(drawn).toContain('Explore')
  expect(drawn).toContain('1 tool calls')
  await ui.press({ key: 'stop-ag1' })
  expect(log.stopped).toEqual(['ag1'])
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"Stopped"')
  // The form starts a new one
  await ui.press({ key: 'spawn-toggle' })
  await ui.drawn()
  await (ui as any).input({ key: 'spawn-task', text: 'write docs', kind: 'change' })
  await ui.drawn()
  await ui.press({ key: 'spawn-go' })
  expect(log.spawned).toContain('write docs')
  // The form closes once the agent has started; the kit hands no agentId back to the caller, so the row itself needs the engine
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toContain('spawn-task')
  await ui.unmount()
})

test('file operations build the Files tab, the chat cards and the progress steps', async ($, on) => {
  stand($, on)
  await $.prompt.submit({ text: 'add rate limiting', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/app.ts', tool_use_id: 'r1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b\nc', tool_use_id: 'e1' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/limit.ts', content: 'x\ny\nz', tool_use_id: 'w1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b1' } as never)
  await $.command.run({ command: 'cockpit', args: 'tab files' } as never)
  const ui = await $.ui.mount(pane('files') as never)
  // The feed: the operations newest first, an edit opening to its diff
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('limit.ts')
  expect(drawn).toContain('"+5"')
  expect(drawn).toContain('" −1"')
  expect(drawn).toContain('"Edit "')
  await ui.press({ key: 'opb-e1' })
  expect(JSON.stringify(await ui.drawn())).toContain('+ c')
  // The tree is the project's: an untouched folder shows folded, and opens on a press
  expect(drawn).toContain('README.md')
  expect(drawn).toContain('docs/')
  expect(drawn).not.toContain('guide.md')
  await ui.press({ key: 'treeb-docs' })
  expect(JSON.stringify(await ui.drawn())).toContain('guide.md')
  // The tree sits above the feed; pressing a file narrows the feed to it
  expect(drawn).toContain('src/')
  await ui.press({ key: 'treeb-repo/src/limit.ts' })
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Feed · repo/src/limit.ts')
  expect(drawn).not.toContain('opb-e1')
  await ui.unmount()
  await $.command.run({ command: 'cockpit', args: 'focus off' } as never)
  const b = await $.ui.mount(band as never)
  const bd = JSON.stringify(await b.drawn())
  // The steps written for this task, reached by the kind of work done
  expect(bd).toContain('Run the tests')
  expect(bd).toMatch(/[5-9]\d%/)
  await b.unmount()
  // Each prompt is a flow: this one shows in the Overview with its steps, changes and state
  await $.turn.complete({ answer: 'done', reason: 'answer', turnId: 't', isAborted: false, durationMs: 1000 } as never)
  await $.prompt.submit({ text: 'second task', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  const ov = await $.ui.mount(pane('overview') as never)
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const od = JSON.stringify(await ov.drawn())
  expect(od).toContain('Flows (2)')
  expect(od).toContain('add rate limiting')
  expect(od).toContain('second task')
  expect(od).toContain('"✓"')
  expect(od).toContain('"●"')
  await ov.press({ key: `flb-${(await ov.find({ text: 'add rate limiting' }))?.key?.replace('flb-', '') ?? ''}` }).catch(() => null)
  await ov.unmount()
  const card = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'ToolUse', requestId: 'e1', props: { tool_use_id: 'e1', tool: 'Edit', input: {}, isRunning: false, isErrored: false, isInterrupted: false } } as never)
  expect(JSON.stringify(await card.drawn())).toContain('Edit app.ts')
  await card.unmount()
})

test('each prompt picks a flow; a question reaches Answer at turn end, a build waits for its commit', async ($, on) => {
  // No steps written for the task: the templates stand
  stand($, on, { noSteps: true })
  // Before the first prompt the Overview lists the predefined flows
  let ui = await $.ui.mount(pane('overview') as never)
  expect(JSON.stringify(await ui.drawn())).toContain('Understand › Explore › Answer')
  await ui.unmount()
  await $.prompt.submit({ text: 'what does the band draw?', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/app.ts', tool_use_id: 'r1' } as never)
  await $.turn.complete({ answer: 'a bar', reason: 'answer', turnId: 't', isAborted: false, durationMs: 1000 } as never)
  ui = await $.ui.mount(pane('overview') as never)
  let d = JSON.stringify(await ui.drawn())
  expect(d).toContain('Answer flow')
  expect(d).toContain('"100%"')
  expect(d).not.toContain(' Commit ')
  await ui.unmount()
  // A question that edits files is a Build: Commit joins its steps and it stays short of done
  await $.prompt.submit({ text: 'how is the ring drawn?', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/ring.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e1' } as never)
  await $.turn.complete({ answer: 'done', reason: 'answer', turnId: 't2', isAborted: false, durationMs: 1000 } as never)
  ui = await $.ui.mount(pane('overview') as never)
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('Build flow')
  expect(d).toContain(' Commit ')
  // Explore was skipped (the edit came first): left out of the count, 2 of 4 steps
  expect(d).toContain('"50%"')
  expect(d).toContain('1 skipped, not counted')
  await ui.unmount()
  // Verify run between turns reaches the closed flow too
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  ui = await $.ui.mount(pane('overview') as never)
  expect(JSON.stringify(await ui.drawn())).toContain('"75%"')
  // A flow picked by hand stands: by command, then by the picker
  const r = await $.command.run({ command: 'cockpit', args: 'flow answer' } as never)
  expect(JSON.stringify(r)).toContain('Answer flow')
  expect(JSON.stringify(await ui.drawn())).toContain('Answer flow')
  await ui.press({ key: 'flow-docs' })
  expect(JSON.stringify(await ui.drawn())).toContain('Docs flow')
  expect(JSON.stringify(await $.command.run({ command: 'cockpit', args: 'flow nope' } as never))).toContain('Flows: build')
  await ui.unmount()
})

test('each prompt gets steps written for its task, moved by the kind of work done', async ($, on) => {
  stand($, on)
  await $.prompt.submit({ text: 'add rate limiting', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/limit.ts', tool_use_id: 'r1' } as never)
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ui = await $.ui.mount(pane('overview') as never)
  let d = JSON.stringify(await ui.drawn())
  expect(d).toContain(' Read the limiter code ')
  expect(d).toContain(' Add the rate limit ')
  expect(d).toContain('steps written for this task')
  expect(d).toContain('0 of 3 steps done')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/limit.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e1' } as never)
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('1 of 3 steps done')
  // A template picked by hand stands over them
  await ui.press({ key: 'flow-build' })
  expect(JSON.stringify(await ui.drawn())).toContain('steps from the Build flow, your pick')
  await ui.unmount()
})

test("while Claude keeps a task list, the flow's steps are its tasks and progress counts them", async ($, on) => {
  stand($, on)
  await $.prompt.submit({ text: 'add rate limiting', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'td1', todos: [
    { content: 'Find the login handler', status: 'completed', activeForm: 'Finding' },
    { content: 'Add the limiter', status: 'in_progress', activeForm: 'Adding' },
    { content: 'Write a test', status: 'pending', activeForm: 'Writing' },
  ] } as never)
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ui = await $.ui.mount(pane('overview') as never)
  let d = JSON.stringify(await ui.drawn())
  expect(d).toContain(' Add the limiter ')
  expect(d).toContain('1 of 3 steps done')
  expect(d).toContain(' + 1 in progress at ½')
  expect(d).toContain(' = 50%')
  expect(d).toContain("steps from Claude's task list")
  // One task at a time: a new task joins, and an update moves it
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 'tc1', subject: 'Update the docs', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'tu1', taskId: 'c3', status: 'completed' } as never)
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('2 of 4 steps done')
  // A template picked by hand stands over the plan; Plan takes it back
  await ui.press({ key: 'flow-build' })
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('steps from the Build flow, your pick')
  await ui.press({ key: 'flow-plan' })
  expect(JSON.stringify(await ui.drawn())).toContain("steps from Claude's task list")
  await ui.unmount()
})

test('a palette paints its own background in the pane and the band, and the chat keeps the terminal\'s text colours', async ($, on) => {
  stand($, on)
  const bgs: Record<string, string> = { paper: '#f3f2f2', white: '#ffffff', black: '#0b0b0b', solarized: '#002b36', nord: '#2e3440' }
  const texts = ['#1d1b18', '#111111', '#e8e6e3', '#eee8d5', '#eceff4']
  for (const [name, bg] of Object.entries(bgs)) {
    await $.command.run({ command: 'cockpit', args: `theme ${name}` } as never)
    const ui = await $.ui.mount(pane('overview') as never)
    const root: any = await ui.drawn()
    expect(root.props.backgroundColor).toBe(bg)
    expect(root.props.minHeight).toBe(60)
    await ui.unmount()
    await $.command.run({ command: 'cockpit', args: 'focus off' } as never)
    const b = await $.ui.mount(band as never)
    expect(((await b.drawn()) as any).props.backgroundColor).toBe(bg)
    await b.unmount()
    // Your message in the chat: the surface's own text colour, never the palette's
    const um = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'UserMessage', requestId: 'um', props: { text: 'hi', origin: { kind: 'composer' }, isExpanded: false } } as never)
    const d = JSON.stringify(await um.drawn())
    for (const c of texts) expect(d).not.toContain(c)
    await um.unmount()
  }
  // Auto paints nothing: it follows the terminal
  await $.command.run({ command: 'cockpit', args: 'theme auto' } as never)
  const ui = await $.ui.mount(pane('overview') as never)
  expect(((await ui.drawn()) as any).props.backgroundColor).toBeUndefined()
  await ui.unmount()
})

test('the context window compacts, or clears after you confirm', async ($, on) => {
  const log = stand($, on)
  const ui = await $.ui.mount(pane('overview') as never)
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  await ui.press({ key: 'ctx-compact' })
  expect(log.compacted).toBe(1)
  expect(log.toasts.join('|')).toContain('Not compacted: the stand keeps the conversation')
  await ui.press({ key: 'ctx-clear' })
  expect(JSON.stringify(await ui.drawn())).toContain('Clear the conversation?')
  expect(log.commands).not.toContain('clear')
  await ui.press({ key: 'ctx-clear-no' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Clear the conversation?')
  await ui.press({ key: 'ctx-clear' })
  await ui.press({ key: 'ctx-clear-yes' })
  expect(log.commands).toContain('clear')
  await ui.unmount()
})

test('Clear runs /clear once, closes the confirm and says so', async ($, on) => {
  const log = stand($, on)
  const ui = await $.ui.mount(pane('overview') as never)
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  await ui.press({ key: 'ctx-clear' })
  await ui.press({ key: 'ctx-clear-yes' })
  expect(log.commands.filter(c => c === 'clear')).toHaveLength(1)
  expect(log.toasts.join('|')).toContain('Context cleared')
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toContain('Clear the conversation?')
  expect(drawn).toContain('ctx-clear')
  await ui.unmount()
})

test('Clear that the engine refuses says why and does not claim success', async ($, on) => {
  const log = stand($, on, { clearFails: true })
  const ui = await $.ui.mount(pane('overview') as never)
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never).catch(() => {})
  await ui.press({ key: 'ctx-clear' })
  await ui.press({ key: 'ctx-clear-yes' })
  expect(log.toasts.join('|')).toContain('Could not clear')
  expect(log.toasts.join('|')).not.toContain('Context cleared')
  expect(JSON.stringify(await ui.drawn())).not.toContain('Clear the conversation?')
  await ui.unmount()
})

test('themes switch by command and by the header dots; Auto uses the theme keys', async ($, on) => {
  stand($, on)
  await $.command.run({ command: 'cockpit', args: 'theme nord' } as never)
  let ui = await $.ui.mount(pane('overview') as never)
  expect(JSON.stringify(await ui.drawn())).toContain('#88c0d0')
  await ui.press({ key: 'theme-paper' })
  expect(JSON.stringify(await ui.drawn())).toContain('#b68235')
  await ui.press({ key: 'theme-auto' })
  const auto = JSON.stringify(await ui.drawn())
  expect(auto).toContain('#b4833a')
  expect(auto).toContain('"color":"text"')
  expect(auto).not.toContain('#e8e6e3')
  await ui.unmount()
})

test('accounts are detected, a token logs in through gh, and the choice is kept per repository', async ($, on) => {
  const log = stand($, on)
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const ui = await $.ui.mount(pane('git') as never)
  await ui.press({ key: 'acct-detect' })
  // An account is now saved: the box shows it, the choices and the login controls wait behind Modify
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"Modify"')
  expect(drawn).not.toContain('gh-token')
  await ui.press({ key: 'acct-modify' })
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('" two "')
  expect(drawn).toContain('" one "')
  await ui.press({ key: 'acct-gh-one' })
  expect(log.store['account:/repo']).toBe('gh-one')
  await (ui as any).input({ key: 'gh-token', text: 'ghp_secret', kind: 'change' })
  await ui.press({ key: 'gh-token-go' })
  const login = log.ran.find(a => a.join(' ').startsWith('gh auth login --with-token'))
  expect(login).toBeDefined()
  expect(log.toasts.some(t => t.includes('Logged in to GitHub'))).toBe(true)
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toContain('ghp_secret')
  // Logged in: the controls are hidden again
  expect(drawn).not.toContain('gh-token')
  await ui.unmount()
})

test('ask mode proposes each commit above the prompt, and Commit makes it', async ($, on) => {
  const log = stand($, on)
  await $.prompt.submit({ text: 'fix the login bug', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.txt', old_string: 'a', new_string: 'b', tool_use_id: 'e1' } as never)
  await $.turn.complete({ answer: 'done', reason: 'answer', turnId: 't', isAborted: false, durationMs: 1000 } as never)
  expect(log.toasts.filter(t => /propos|ommit/.test(t))).toEqual(['◆ Commit proposed: fix: fix the login bug'])
  const b = await $.ui.mount(band as never)
  const drawn = JSON.stringify(await b.drawn())
  expect(drawn).toContain('Commit?')
  expect(drawn).toContain('fix/fix-the-login-bug')
  await b.press({ key: 'ph-commit' })
  const commit = log.ran.find(a => a.includes('commit'))
  expect(commit).toContain('fix: fix the login bug')
  expect(log.ran.some(a => a.join(' ').startsWith('git switch') && a.includes('fix/fix-the-login-bug'))).toBe(true)
  await b.unmount()
})

test('the context and cost come from the session usage', async ($, on) => {
  stand($, on)
  await $.session.measure({} as never)
  const ui = await $.ui.mount(pane('overview') as never)
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('50k')
  expect(drawn).toContain('$1.50')
  expect(drawn).toContain('Messages')
  await ui.unmount()
})
