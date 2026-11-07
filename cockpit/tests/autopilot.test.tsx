import { expect, test } from 'claude-code/testing'
import { parseOptions } from '../hooks/ops/decisions'

// The autopilot's two roles end to end, with the engine stood in: a file system in memory, judges whose replies the
// test writes, and the prompts Cockpit sends
const scroll = { offset: 0, bodyRows: 80 }
const pane = { plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 100, placement: 'dock', scroll, view: {} } }
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
const settle = () => new Promise(res => (globalThis as any).setTimeout(res, 60))

function stand(on: any) {
  const log = { submitted: [] as string[], notes: [] as string[], judged: [] as string[], files: {} as Record<string, string>, vote: '1 - it is fine' }
  let clock = 1_000_000
  on('clock.now', async () => ({ value: (clock += 1000) }))
  on('clock.after', async (_: unknown, e: any) => (await new Promise(res => (globalThis as any).setTimeout(res, e.ms)), { value: undefined }) as never)
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd.startsWith('git rev-parse --show-toplevel')) return ok('/repo\n')
    if (cmd.startsWith('git status')) return ok('## master\0')
    if (cmd.startsWith('git log --oneline')) return ok('abc1234 feat: the work so far\n')
    return ok('')
  })
  on('fs.read', async (_: unknown, e: any) => {
    const f = log.files[posix(e.path)]
    if (f === undefined) throw new Error('ENOENT')
    return { value: f }
  })
  on('fs.write', async (_: unknown, e: any) => ((log.files[posix(e.path)] = String(e.text)), { value: undefined }))
  on('fs.exists', async (_: unknown, e: any) => ({ value: posix(e.path) in log.files }))
  on('fs.list', async () => ({ value: [] }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 1 } } }))
  on('model.complete', async (_: unknown, e: any) => {
    const p = String(e.prompt)
    if (p.startsWith('Rate how complex')) return { value: { isAnswered: true, text: '{"score": 2, "signals": ["small"]}', usage: { inputTokens: 1, outputTokens: 1 } } }
    if (p.startsWith('Context:')) log.judged.push(p)
    return { value: { isAnswered: true, text: p.startsWith('Context:') ? log.vote : '[]', usage: { inputTokens: 1, outputTokens: 1 } } }
  })
  on('model.fork', async () => ({ value: { isAnswered: true, text: 'A summary.', usage: { inputTokens: 1, outputTokens: 1 } } }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => (e.origin?.kind === 'plugin' && log.submitted.push(String(e.text)), { text: e.text }))
  on('session.append', async (_: unknown, e: any, next: any) => (log.notes.push(JSON.stringify(e.message?.content ?? '')), next(e)))
  return log
}

// One cycle as Claude would run it: the turn the prompt Cockpit sent starts (and with it the cycle's flow), files
// change, the turn ends with its answer
async function cycle($: any, log: { submitted: string[] }, answer: string, edit = true) {
  await $.turn.start({ text: log.submitted.at(-1)!, turnId: 't' } as never).catch(() => null)
  if (edit) await $.tool.call({ tool: 'Edit', file_path: '/repo/src/ui.ts', old_string: 'a', new_string: 'b', tool_use_id: `e${log.submitted.length}` } as never)
  await $.turn.complete({ answer, reason: 'answer', turnId: 't', isAborted: false, durationMs: 1000 } as never)
  await settle()
}

const overview = async ($: any) => {
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ui = await $.ui.mount(pane as never)
  const d = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return d
}

test('a finished roadmap the judges doubt ends in two claims, not a loop: their reasons and the evidence carry over', { timeoutMs: 20_000 }, async ($, on) => {
  const log = stand(on)
  await $.command.run({ command: 'cockpit', args: 'task polish the ui' } as never)
  await settle()
  expect(log.submitted.at(-1)).toContain('Autopilot, cycle 1. Goal: polish the ui')
  // A goal starts on a roadmap of its own
  expect(log.files['/repo/.cockpit/roadmap.md']).toBe('# Roadmap: polish the ui\n\n')
  log.files['/repo/.cockpit/roadmap.md'] = '# Roadmap: polish the ui\n- [x] spacing: the sizes test passes\n- [x] colours: the contrast test passes\n'
  // Claude claims done; the judges read the roadmap and the commits, and say what is missing
  log.vote = '2 - the header contrast in dark mode is not checked'
  await cycle($, log, 'Everything passes.\nAUTOPILOT: DONE every milestone passes')
  expect(log.judged.at(-1)).toContain('- [x] spacing: the sizes test passes')
  expect(log.judged.at(-1)).toContain('abc1234 feat: the work so far')
  const second = log.submitted.at(-1)!
  expect(second).toContain('Autopilot, cycle 2.')
  expect(second).toContain('the header contrast in dark mode is not checked')
  expect(second).toContain('Add each as a milestone')
  // The cycle remembers what the earlier one did
  expect(second).toContain('What the earlier cycles of this goal did')
  expect(second).toContain('- cycle 1: +1 −1 lines')
  expect(await overview($)).toContain('Judges: not done yet')
  // Claude claims done again without taking in a single point: it stops for you instead of cycling on
  await cycle($, log, 'Still all good.\nAUTOPILOT: DONE nothing left', false)
  expect(log.submitted.length).toBe(2)
  const d = await overview($)
  expect(d).toContain('AUTOPILOT · PAUSED')
  expect(d).toContain('the judges still find it not done')
  // The judges' reasons show in the Decisions card, each under its seat
  const id = d.match(/decb-(ap-\d+-2)/)?.[1]
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: `decb-${id}` })
  expect(JSON.stringify(await ui.drawn())).toContain('Pragmatist · Not done yet: ')
  await ui.unmount()
})

test('cycles that tick nothing are told to change approach, and a reworded next step is no progress', { timeoutMs: 20_000 }, async ($, on) => {
  const log = stand(on)
  await $.command.run({ command: 'cockpit', args: 'task add offline sync' } as never)
  await settle()
  log.files['/repo/.cockpit/roadmap.md'] = '# Roadmap: add offline sync\n- [ ] queue: the queue test passes\n'
  await cycle($, log, 'AUTOPILOT: CONTINUE the queue')
  expect(log.submitted.at(-1)).not.toContain('Do not repeat the last approach')
  await cycle($, log, 'AUTOPILOT: CONTINUE the queue, again')
  expect(log.submitted.at(-1)).toContain('No milestone has been ticked for 2 cycles')
  // Rewording the next milestone while nothing changes still counts toward the stall
  for (const w of ['one', 'two', 'three']) await cycle($, log, `AUTOPILOT: CONTINUE the queue, ${w}`, false)
  expect(await overview($)).toContain('three cycles in a row changed nothing')
})

test('the product owner scouts, the judges pick its next goal, the task builds it, and the next round starts', { timeoutMs: 20_000 }, async ($, on) => {
  const log = stand(on)
  // With the judges off, or only advising, nobody would choose
  for (const m of ['off', 'ask']) {
    await $.command.run({ command: 'cockpit', args: `mode ${m}` } as never)
    expect(JSON.stringify(await $.command.run({ command: 'cockpit', args: 'product a great notes app' } as never))).toContain('needs the judges')
  }
  await $.command.run({ command: 'cockpit', args: 'mode auto' } as never)
  log.files['/repo/.cockpit/roadmap.md'] = '# Roadmap: an older goal\n- [x] old: done\n'
  await $.command.run({ command: 'cockpit', args: 'product $50 a great notes app' } as never)
  await settle()
  expect(log.submitted.at(-1)).toContain('Product owner, round 1. Vision: a great notes app')
  expect(log.submitted.at(-1)).toContain('search the web')
  expect(await overview($)).toContain('PRODUCT OWNER · ROUND 1 · SCOUTING')
  // Its options go to the judges, who pick the second; the task starts on it, on a roadmap of its own
  log.vote = '2 - users ask for it most'
  await cycle($, log, 'Studied the field.\nPRODUCT: OPTION add tags :: every rival has them\nPRODUCT: OPTION add offline sync :: the most asked-for feature\nPRODUCT: OPTION Add tags :: said twice\nPRODUCT: OPTION add themes :: cheap', false)
  // A repeated option is listed once
  expect(log.judged.at(-1)?.match(/^\d+\. add tags/gim)?.length).toBe(1)
  expect(log.judged.at(-1)).toContain('Vision: a great notes app')
  expect(log.submitted.at(-1)).toContain('Autopilot, cycle 1. Goal: add offline sync')
  expect(log.submitted.at(-1)).toContain("product owner's pick, toward the vision: a great notes app")
  expect(log.notes.join()).toContain('Next goal, by the judges: add offline sync')
  expect(log.files['/repo/.cockpit/roadmap.md']).toBe('# Roadmap: add offline sync\n\n')
  expect(Object.keys(log.files).some(f => f.startsWith('/repo/.cockpit/roadmaps/an-older-goal-'))).toBe(true)
  // The goal built and agreed done: the next round scouts again, knowing what was built
  log.files['/repo/.cockpit/roadmap.md'] = '# Roadmap: add offline sync\n- [x] queue: passes\n'
  log.vote = '1 - the tests prove it'
  await cycle($, log, 'AUTOPILOT: DONE the queue syncs offline')
  expect(log.submitted.at(-1)).toContain('Product owner, round 2.')
  expect(log.submitted.at(-1)).toContain('Built so far, oldest first: add offline sync')
  const d = await overview($)
  expect(d).toContain('PRODUCT OWNER · ROUND 2 · SCOUTING')
  expect(d).toContain('1 goal built')
  // The next goal's cycles remember only its own: none of the last goal's cycles or commits carry over
  log.vote = '1 - add search'
  await cycle($, log, 'PRODUCT: OPTION add search :: asked for\nPRODUCT: OPTION add export :: rivals have it', false)
  expect(log.submitted.at(-1)).toContain('Goal: add search')
  log.files['/repo/.cockpit/roadmap.md'] = '# Roadmap: add search\n- [ ] index: passes\n'
  await cycle($, log, 'AUTOPILOT: CONTINUE the index')
  expect(log.submitted.at(-1)).toContain('- cycle 1: +1 −1 lines')
  expect(log.submitted.at(-1)?.match(/- cycle \d+:/g)?.length).toBe(1)
})

test('the product owner\'s options parse from decorated, CRLF and odd lines, and a line with no goal is none', () => {
  const o = parseOptions('> PRODUCT: OPTION quoted :: a\r\n- PRODUCT: OPTION use a::b namespace :: b\n**PRODUCT: OPTION bold** :: c\nPRODUCT: OPTION :: no goal\nPRODUCT: OPTION plain')
  expect(o).toEqual([
    { label: 'quoted', description: 'a' },
    { label: 'use a::b namespace', description: 'b' },
    { label: 'bold', description: 'c' },
    { label: 'plain', description: '' },
  ])
})

test('the judges\' "option N" votes count; a product owner nobody voted for, or one stuck goal after another, pauses', { timeoutMs: 20_000 }, async ($, on) => {
  const log = stand(on)
  await $.command.run({ command: 'cockpit', args: 'product a great notes app' } as never)
  await settle()
  // Every judge answers off the point: no goal is built in their name
  log.vote = 'Hard to say.'
  await cycle($, log, 'PRODUCT: OPTION add tags :: a\nPRODUCT: OPTION add sync :: b', false)
  expect(await overview($)).toContain('no judge gave a usable vote on the next goal')
  // "option number 2" is a vote for the second
  log.vote = 'I would pick option number 2, it matters most'
  await $.command.run({ command: 'cockpit', args: 'product resume' } as never)
  await settle()
  await cycle($, log, 'PRODUCT: OPTION add tags :: a\nPRODUCT: OPTION add sync :: b', false)
  expect(log.submitted.at(-1)).toContain('Goal: add sync')
  // Three goals in a row set aside (each three cycles that change nothing) pause it instead of scouting on
  for (let g = 0; g < 3; g++) {
    for (let c = 0; c < 3; c++) await cycle($, log, 'AUTOPILOT: CONTINUE same', false)
    if (g < 2) await cycle($, log, `PRODUCT: OPTION goal ${g}a :: a\nPRODUCT: OPTION goal ${g}b :: b`, false)
  }
  expect(await overview($)).toContain('three goals in a row were set aside')
})
