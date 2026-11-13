import { expect, test } from 'claude-code/testing'
import { openMore, ok, posix } from './more'
import { AUTO } from '../hooks/core/theme'
import { passedOf } from '../hooks/agents/experts'
import { MODES } from '../hooks/core/modes'

// One fact, one wording: what the pane, the band above the prompt, the line under it and /cockpit say of the same
// thing is the same word, number and colour
const scroll = { offset: 0, bodyRows: 80 }
const pane = { plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 100, placement: 'dock', scroll, view: {} } }
const band = { plugin: 'cockpit', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll, view: {} } }
const hint = { plugin: 'cockpit', surface: 'terminal', component: 'PromptHint', requestId: 'hint', props: { isDraft: false, isWorking: false, hint: '' } }
const spinner = { plugin: 'cockpit', surface: 'terminal', component: 'Spinner', requestId: 'sp', props: { word: 'Working', message: null, suffix: '', mode: 'tool-use' } }
const settle = () => new Promise(res => (globalThis as any).setTimeout(res, 60))

function stand(on: any) {
  const files: Record<string, string> = {}
  // How full the context is, as the test sets it before the next measure
  const usage = { percent: 25 }
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('clock.after', async (_: unknown, e: any) => (await new Promise(res => (globalThis as any).setTimeout(res, e.ms)), { value: undefined }) as never)
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.notify', async () => ({ value: { isSent: true, channel: 'terminal' } }) as never)
  on('ui.panes', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('agent.list', async () => ({ value: [] }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: usage.percent * 2000, percent: usage.percent, breakdown: { categories: [{ name: 'Messages', tokens: usage.percent * 2000 }], totalTokens: usage.percent * 2000 } }, rateLimits: [], cost: { usd: 0 } } }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd.startsWith('git rev-parse --show-toplevel')) return ok('/repo\n')
    if (cmd.startsWith('git status')) return ok('## feat/x\0')
    if (cmd.startsWith('git branch')) return ok('main\nfeat/x\n')
    if (cmd.startsWith('gh pr view')) return ok('{"number":7,"title":"Add x","url":"https://github.com/o/r/pull/7","state":"OPEN","isDraft":false,"reviewDecision":"REVIEW_REQUIRED"}')
    // gh exits 1 when a check failed, printing the JSON all the same
    if (cmd.startsWith('gh pr checks')) return ok('[{"name":"test","bucket":"fail","link":"https://github.com/o/r/actions/runs/42/job/1"},{"name":"lint","bucket":"pass"}]', 1)
    return ok('')
  })
  on('fs.read', async (_: unknown, e: any) => {
    const f = files[posix(e.path)]
    if (f === undefined) throw new Error('ENOENT')
    return { value: f }
  })
  on('fs.write', async (_: unknown, e: any) => ((files[posix(e.path)] = String(e.text)), { value: undefined }))
  on('fs.exists', async (_: unknown, e: any) => ({ value: posix(e.path) in files }))
  on('fs.list', async () => ({ value: [] }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('model.fork', async () => ({ value: { isAnswered: true, text: 'A summary.', usage: { inputTokens: 1, outputTokens: 1 } } }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('turn.start', async (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  on('session.append', async (_: unknown, e: any, next: any) => next(e))
  return usage
}

const run = async ($: any, args: string) => String(((await $.command.run({ command: 'cockpit', args } as never)) as any)?.text ?? '')
// What a site draws, as text to search
const drawnOf = async ($: any, site: unknown, more = false) => {
  const ui = await $.ui.mount(site as never)
  if (more) await openMore(ui)
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}
const textOf = async ($: any, site: unknown, more = false) => JSON.stringify(await drawnOf($, site, more))
// Every Text whose own words match, innermost first
type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const texts = (n: unknown, re: RegExp): El[] => {
  if (!n || typeof n !== 'object') return []
  const el = n as El
  const kids = Array.isArray(el.children) ? el.children : []
  return [...kids.flatMap(k => texts(k, re)), ...(el.type === 'Text' && kids.some(k => typeof k === 'string' && re.test(k)) ? [el] : [])]
}
// The Text that holds one: a heading's own props sit on the Text around its words
const holders = (n: unknown, re: RegExp): El[] => {
  if (!n || typeof n !== 'object') return []
  const el = n as El
  const kids = Array.isArray(el.children) ? el.children : []
  return [...kids.flatMap(k => holders(k, re)), ...(el.type === 'Text' && kids.some(k => texts(k, re).length > 0 && (k as El).children?.some(c => typeof c === 'string' && re.test(c))) ? [el] : [])]
}

test('the decision mode reads the same in the header, under the Overview, under the prompt and from /cockpit mode', { timeoutMs: 20_000 }, async ($, on) => {
  stand(on)
  for (const m of MODES) {
    // The command's answer is the status every site then shows
    expect(await run($, `mode ${m.id}`)).toBe(`Decisions: ${m.status}`)
    await run($, 'tab overview')
    const p = await textOf($, pane, true)
    // Twice in the pane: its header, and beside the folded Decisions heading
    expect(p.split(`"${m.status}"`).length - 1).toBe(2)
    expect(await textOf($, hint)).toContain(`"${m.status}"`)
  }
  // The buttons that pick a mode, under the Decisions heading, say each one's own label
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'fold-dec' })
  const picks = JSON.stringify(await ui.drawn())
  for (const m of MODES) expect(picks).toContain(`" ${m.label} "`)
  await ui.unmount()
  // A word that is no mode lists the three with what each means, and changes nothing
  const usage = await run($, 'mode sometimes')
  for (const m of MODES) expect(usage).toContain(`${m.id} (${m.what})`)
  expect(await textOf($, hint)).toContain(`"${MODES[2]!.status}"`)
})

test("a pull request's review and checks are worded the same on the Overview and the Git tab", { timeoutMs: 20_000 }, async ($, on) => {
  stand(on)
  await run($, 'tab git')
  const ui = await $.ui.mount(pane as never)
  for (const key of ['setup-next', 'setup-next', 'setup-next', 'setup-next', 'setup-done']) await ui.press({ key })
  await openMore(ui)
  const git = JSON.stringify(await ui.drawn())
  await ui.unmount()
  const line = 'PR #7 review required · checks 1 failing'
  // The Git tab's first line, and its pull request row in GitHub's own term
  expect(git).toContain(line)
  expect(git).toContain('"review required"')
  await run($, 'tab overview')
  const ov = await textOf($, pane)
  expect(ov).toContain(`"${line}"`)
  expect(ov).not.toContain('review needed')
})

test('a context window 85% full is the theme\'s red on the Overview and in the band, Focus on or off; at 60% amber in all three', { timeoutMs: 20_000 }, async ($, on) => {
  const usage = stand(on)
  for (const [percent, want] of [[85, AUTO.bad], [60, AUTO.busy]] as const) {
    usage.percent = percent
    await $.session.measure({} as never)
    await run($, 'focus on')
    const focused = texts(await drawnOf($, band), new RegExp(`context ${percent}%`))
    expect(focused.map(x => x.props?.color)).toEqual([want])
    await run($, 'focus off')
    const open = texts(await drawnOf($, band), new RegExp(`^\\s*${percent}%$`))
    expect(open.map(x => x.props?.color)).toEqual([want])
    await run($, 'tab overview')
    const ov = texts(await drawnOf($, pane, true), new RegExp(`^${percent}%$`))
    expect(ov.map(x => x.props?.color)).toEqual([want])
  }
})

test('the step number is the same on the Overview, in the band and on the spinner, a skipped step before it included', { timeoutMs: 20_000 }, async ($, on) => {
  stand(on)
  // An edit with no reading first: Explore is skipped, and Implement, third of the Build flow's five, is in progress
  await $.prompt.submit({ text: 'fix the login bug', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'fix the login bug', turnId: 't' } as never).catch(() => null)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.txt', old_string: 'a', new_string: 'b', tool_use_id: 'e1' } as never)
  await settle()
  await run($, 'tab overview')
  const ov = await textOf($, pane)
  expect(ov).toContain('↷ Explore')
  expect(ov).toContain('step 3 of 5')
  await run($, 'focus on')
  expect(await textOf($, band)).toContain('Step 3 of 5')
  expect(await textOf($, spinner)).toContain('Implement 3/5')
})

test('a test case counts as passed when it passed or was fixed: one still running is no pass', () => {
  expect(passedOf([{ st: 'pass' }, { st: 'fixed' }, { st: 'run' }, { st: 'fail' }])).toBe(2)
  expect(passedOf([])).toBe(0)
})

test('the autopilot is named in the same words in the band as in the Overview\'s heading', { timeoutMs: 20_000 }, async ($, on) => {
  stand(on)
  await run($, 'task polish the ui')
  await settle()
  await run($, 'focus on')
  const words = '⟳ Autopilot · cycle 1'
  expect(await textOf($, band)).toContain(words)
  await run($, 'tab overview')
  expect(await textOf($, pane)).toContain(`"${words.toUpperCase()}"`)
  // Stopped, the Overview says so in the same shape, and the band, which names only work under way, says nothing
  await run($, 'task stop')
  expect(await textOf($, pane)).toContain('"⟳ AUTOPILOT · STOPPED"')
  expect(await textOf($, band)).not.toContain('Autopilot')
})

test('a section heading is drawn one way on every tab', { timeoutMs: 20_000 }, async ($, on) => {
  stand(on)
  const looks: string[] = []
  for (const [tab, word] of [['overview', 'CODEBASE GUIDE'], ['agents', 'TEAM'], ['rules', 'HOOKS']] as const) {
    await run($, `tab ${tab}`)
    await settle()
    const tree = await drawnOf($, pane, true)
    const head = holders(tree, new RegExp(`^${word}$`))
    expect(head.length).toBe(1)
    looks.push(JSON.stringify(head[0]!.props))
  }
  expect(looks).toEqual(Array(3).fill(JSON.stringify({ size: 'footnote', bold: true, wrap: 'truncate-end' })))
})
