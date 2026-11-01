import { expect, test } from 'claude-code/testing'
import { neuralSvg } from '../hooks/logic'

// The layout's promises, each checked by drawing a tab with a pipeline, agents and a changed file
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
test('Activity tells one story: agents\' events fill the feed, so the tab never says it has nothing, and the count matches the rows; empty lists all say None yet, and an agent\'s result shows once', { timeoutMs: 20_000 }, async ($, on) => {
  let clock = 1_000_000
  let spawns = 0
  on('clock.now', async () => ({ value: (clock += 900) }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd.startsWith('git status')) return ok('## main\0 M src/auth.ts\0')
    return ok('')
  })
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('agent.spawn', async () => ({ model: 'haiku', agentId: `ag${++spawns}` }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  await $.prompt.submit({ text: 'fix the empty password bug in login', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/auth.ts', agentId: 'ag1', tool_use_id: 'x1' } as never)
  await $.turn.complete({ agentId: 'ag1', answer: 'CASE PASS login works\nCASE PASS logout works\nCASE PASS session expires\nREPORT: the three happy paths pass\nHANDOFF: try empty and very long passwords', reason: 'answer', turnId: 'x', isAborted: false, durationMs: 1000 } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test -- auth', agentId: 'ag2', tool_use_id: 'x2' } as never)
  await $.command.run({ command: 'cockpit', args: 'run reviewer -- review the login diff' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'password', agentId: 'ag3', tool_use_id: 'x3' } as never)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'ag2', tool_use_id: 'p2', todos: [{ content: 'Find the login handler', status: 'completed', activeForm: 'x' }, { content: 'Try empty passwords', status: 'completed', activeForm: 'x' }, { content: 'Try very long passwords', status: 'in_progress', activeForm: 'x' }, { content: 'Write the CASE lines', status: 'pending', activeForm: 'x' }] } as never)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'ag3', tool_use_id: 'p3', todos: [{ content: 'Read the login diff', status: 'in_progress', activeForm: 'x' }, { content: 'Check the error paths', status: 'pending', activeForm: 'x' }, { content: 'List the findings', status: 'pending', activeForm: 'x' }] } as never)
  await $.command.run({ command: 'cockpit', args: 'tab files' } as never)
  const ui = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} } } as never)
  const d = JSON.stringify(await ui.drawn())
  await ui.unmount()
  expect(d).not.toContain('No files found here yet')
  // Six events: the agents' tool calls and the Prover's report
  expect(d).toContain('6 events · 3 agents')
  // Every empty list says it the same way: the Rules tab's three lists, before anything is added
  await $.command.run({ command: 'cockpit', args: 'tab rules' } as never)
  const rules = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} } } as never)
  const r = JSON.stringify(await rules.drawn())
  await rules.unmount()
  expect(r.split('"None yet."').length - 1).toBe(3)
  expect(r).not.toContain('"None."')
  // A finished agent's result shows once, on its Finished row; its Team row points there
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ag = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} } } as never)
  const a = JSON.stringify(await ag.drawn())
  await ag.unmount()
  expect(a.split('3/3 passed').length - 1).toBe(1)
  expect(a.split('the three happy paths pass').length - 1).toBe(1)
  expect(a).toContain('done ↓')
})

test('Checks read plainly: passes are counted in words, and a tester still at work says running without a ✓ of its own', { timeoutMs: 20_000 }, async ($, on) => {
  let clock = 1_000_000
  let spawns = 0
  on('clock.now', async () => ({ value: (clock += 900) }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd.startsWith('git status')) return ok('## main\0 M src/auth.ts\0')
    return ok('')
  })
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('agent.spawn', async () => ({ model: 'haiku', agentId: `ag${++spawns}` }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  await $.prompt.submit({ text: 'fix the empty password bug in login', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/auth.ts', agentId: 'ag1', tool_use_id: 'x1' } as never)
  await $.turn.complete({ agentId: 'ag1', answer: 'CASE PASS login works\nCASE PASS logout works\nCASE PASS session expires\nREPORT: the three happy paths pass\nHANDOFF: try empty and very long passwords', reason: 'answer', turnId: 'x', isAborted: false, durationMs: 1000 } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test -- auth', agentId: 'ag2', tool_use_id: 'x2' } as never)
  await $.command.run({ command: 'cockpit', args: 'run reviewer -- review the login diff' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'password', agentId: 'ag3', tool_use_id: 'x3' } as never)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'ag2', tool_use_id: 'p2', todos: [{ content: 'Find the login handler', status: 'completed', activeForm: 'x' }, { content: 'Try empty passwords', status: 'completed', activeForm: 'x' }, { content: 'Try very long passwords', status: 'in_progress', activeForm: 'x' }, { content: 'Write the CASE lines', status: 'pending', activeForm: 'x' }] } as never)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'ag3', tool_use_id: 'p3', todos: [{ content: 'Read the login diff', status: 'in_progress', activeForm: 'x' }, { content: 'Check the error paths', status: 'pending', activeForm: 'x' }, { content: 'List the findings', status: 'pending', activeForm: 'x' }] } as never)
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ui = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} } } as never)
  const d = JSON.stringify(await ui.drawn())
  await ui.unmount()
  // The Prover passed three; the Breaker is still at work
  expect(d).toContain('✓ 3 passed')
  expect(d).toContain('· more running')
  expect(d).not.toContain('✓3')
  // The header is one row, and the turn's time is in its badge alone
  const head = JSON.parse(d).children[0]
  expect(head.props.flexDirection ?? 'row').toBe('row')
  expect(JSON.stringify(head)).toContain('Running · ')
  expect(d).not.toContain('Elapsed')
  expect(d).not.toContain('a Claude Code mod')
  // Explore and Implement were passed over: marked ↷ with a legend, never struck through
  expect(d).toContain('" ↷"')
  expect(d).toContain('↷ skipped')
  expect(d).not.toContain('"strikethrough":true')
})

// The neural view: no line runs through a neuron's name or line of work. Each label's box is measured from its text
// (about 6.5px a character, 13px tall, centred), and each line is sampled along its curve
test('the neural view\'s lines stay clear of every label, and end at the circles\' rims', async () => {
  const c = { accent: '#b4833a', busy: '#d9a441', ok: '#5cc98a', bad: '#ef6b6b', text: '#ddd', dim: '#888', track: '#333', bg: '#222' }
  const ns = [
    { id: 'r', name: 'Reviewer', line: 'Read the login diff', state: 'running' as const, pct: 0 },
    { id: 'p', name: 'Prover', line: 'the three happy paths pass', state: 'done' as const },
    { id: 'b', name: 'Breaker', line: 'Try very long passwords', state: 'running' as const, pct: 0.5, link: 'p' },
    { id: 'm1', name: 'Builder', line: 'fixed the login form', state: 'memory' as const },
    { id: 'm2', name: 'Prover', line: 'covered the sign-up', state: 'memory' as const },
  ]
  for (const width of [360, 560]) {
    const svg = neuralSvg('fix the empty password bug in login', ns, c, width)
    const boxes = [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*font-size="(1[02]\.?5?|12)"[^>]*>([^<]{2,})<\/text>/g)]
      .filter(m => !/^\w$/.test(m[4] ?? ''))
      .map(m => { const [x, y, w] = [Number(m[1]), Number(m[2]), (m[4] ?? '').length * 6.5]; return { x0: x - w / 2, x1: x + w / 2, y0: y - 11, y1: y + 2, t: m[4] ?? '' } })
    // The core's own words are inside its circle, where no line reaches
    const labels = boxes.filter(b => !'fix the empty password bug in login'.includes(b.t.replace('…', '')))
    expect(labels.length).toBe(ns.length * 2)
    for (const m of svg.matchAll(/<path d="M([\d.-]+) ([\d.-]+) Q([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/g)) {
      const [x0 = 0, y0 = 0, qx = 0, qy = 0, x1 = 0, y1 = 0] = m.slice(1).map(Number)
      for (let i = 0; i <= 40; i++) {
        const k = i / 40
        const x = (1 - k) ** 2 * x0 + 2 * (1 - k) * k * qx + k ** 2 * x1
        const y = (1 - k) ** 2 * y0 + 2 * (1 - k) * k * qy + k ** 2 * y1
        const hit = labels.find(b => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1)
        expect(hit?.t ?? '').toBe('')
      }
    }
  }
})

