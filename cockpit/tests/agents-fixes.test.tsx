import { expect, test } from 'claude-code/testing'
import { openMore, posix, deskPane as pane } from './more'
import { agentGraph } from '../hooks/agents/agents-view'
import { agentName, parseReport, reportPart, recallOf } from '../hooks/core/experts'
import { standingWarning } from '../hooks/core/spend'
import { nJ, SEATS, SEAT_NAMES } from '../hooks/judges/judges'
import { resolveMemory } from '../hooks/rules/rules'

// The fix round's agents, judges, budget and memory-file defects, each driven the way a person or Claude meets it

const settle = (ms = 120) => new Promise(res => (globalThis as any).setTimeout(res, ms))
const spawnEvent = (type: string, description: string) => ({ tool_use_id: `t-${description}`, prompt: description, description, subagentType: type, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'x', background: true, fork: false })
const finish = ($: any, agentId: string, answer: string) => $.turn.complete({ agentId, answer, reason: 'answer', turnId: agentId, isAborted: false, durationMs: 1000 } as never)

// A session with the engine stood in. id: the id the next start is given; noVerdict: auto mode refuses every start;
// drops: how many hand-offs to Claude the engine drops before it takes one; listed: what `git worktree list` answers
// once a worktree was made; score: the judges' complexity score
function stand(on: any, opt: { id?: () => string; noVerdict?: boolean; drops?: number; listed?: () => string; score?: number; prefs?: Record<string, unknown>; disk?: Record<string, string>; unreadable?: string[] } = {}) {
  const log = { toasts: [] as string[], notes: [] as string[], notices: [] as { title?: string; text: string }[], tried: [] as string[], taken: [] as string[], ran: [] as string[], systems: [] as string[], saved: [] as Record<string, unknown>[] }
  const disk = opt.disk ?? {}
  let spawns = 0
  let drops = opt.drops ?? 0
  on('clock.now', async () => ({ value: 1_700_000_000_000 }))
  on('clock.after', async (_: unknown, e: any) => (await new Promise(res => (globalThis as any).setTimeout(res, e.ms)), { value: undefined }) as never)
  on('ui.toast', async (_: unknown, e: any) => (log.toasts.push(String(e.text)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }) as never)
  on('ui.notify', async (_: unknown, e: any) => (log.notices.push({ title: e.title, text: String(e.text) }), { value: { isSent: true, channel: 'terminal' } }) as never)
  on('store.get', async (_: unknown, e: any) => ({ value: e.key === 'prefs' ? opt.prefs : undefined }))
  on('store.set', async (_: unknown, e: any) => (e.key === 'prefs' && log.saved.push(e.value), { value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.append', async (_: unknown, e: any, next: any) => (log.notes.push(JSON.stringify(e.message?.content ?? '')), next(e)))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 0 } } }))
  on('env.get', async (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.list', async () => ({ value: [] }) as never)
  on('fs.exists', async (_: unknown, e: any) => ({ value: posix(e.path) in disk }))
  on('fs.stat', async (_: unknown, e: any) => {
    if (!(posix(e.path) in disk)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: disk[posix(e.path)]!.length, mtimeMs: 0, isLink: false } } as never
  })
  on('fs.read', async (_: unknown, e: any) => {
    const p = posix(e.path)
    if (opt.unreadable?.includes(p)) throw new Error('EACCES: permission denied')
    if (!(p in disk)) throw new Error('ENOENT')
    return { value: disk[p] } as never
  })
  on('fs.write', async (_: unknown, e: any) => ((disk[posix(e.path)] = String(e.text)), { value: undefined }))
  on('model.fork', async () => ({ value: { isAnswered: true, text: 'A summary.', usage: { inputTokens: 1, outputTokens: 1 } } }))
  on('model.complete', async (_: unknown, e: any) => {
    if (String(e.prompt).startsWith('Rate how complex')) return { value: { isAnswered: true, text: `{"score": ${opt.score ?? 2}, "signals": []}`, usage: { inputTokens: 1, outputTokens: 1 } } }
    if (String(e.system ?? '').includes('on a panel')) return (log.systems.push(String(e.system)), { value: { isAnswered: true, text: '1 - fine', usage: { inputTokens: 1, outputTokens: 1 } } })
    return { value: { isAnswered: false, reason: 'empty-reply' } } as never
  })
  on('tool.check', async () => ({ decision: 'allow' }) as never)
  on('tool.call', async () => ({ result: 'ok' }))
  on('agent.spawn', async () => (opt.noVerdict ? { deny: 'The auto mode classifier gave no verdict for Agent' } : { model: 'haiku', agentId: opt.id?.() ?? `ag${++spawns}` }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => {
    if (e.origin?.kind !== 'plugin') return { text: e.text }
    log.tried.push(String(e.text))
    if (drops-- > 0) return { drop: 'busy' } as never
    log.taken.push(String(e.text))
    return { text: e.text }
  })
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (e.argv as string[]).join(' ')
    log.ran.push(cmd)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal: no' : '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    if (cmd === 'git rev-parse --verify -q HEAD') return out('head1\n')
    if (cmd === 'git rev-parse --git-common-dir') return out('.git\n')
    if (cmd.startsWith('git status')) return out('## main\0')
    if (opt.listed && cmd.startsWith('git worktree remove')) return out('', 128)
    if (cmd.startsWith('git worktree list')) return out(opt.listed?.() ?? 'worktree /repo\n')
    if (cmd === 'git rev-parse --git-path cockpit-index') return out('.git/cockpit-index\n')
    if (cmd === 'git write-tree') return out('tree1\n')
    if (cmd.startsWith('git commit-tree')) return out('snap1\n')
    if (cmd.startsWith('git diff --numstat')) return out('2\t1\tsrc/a.ts\0')
    return out('')
  })
  return log
}

// The New agent form, opened on the Agents tab, with a type typed in and a task; started
async function startFromForm($: any, type: string, task: string, tick?: string) {
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await openMore(ui)
  await ui.press({ key: 'spawn-toggle' })
  if (tick) await ui.press({ key: tick })
  if (type) await (ui as any).input({ key: 'spawn-type-custom', text: type, kind: 'change' })
  await (ui as any).input({ key: 'spawn-task', text: task, kind: 'change' })
  await ui.press({ key: 'spawn-go' })
  return ui
}

// Fix 1 (the kit hands a pane start no agent id, so the form's own row cannot be drawn here: the rule is driven
// through the engine's list and its spawn events, which name a row by the same function)
test('an agent is named the same however Cockpit learned of it, and a row keeps the name it has', { timeoutMs: 20_000 }, async ($, on) => {
  // The one rule: the expert's name, else what it was described as, else Agent or its type
  expect([agentName('cockpit:planner', 'plan it'), agentName('cockpit:api-guard'), agentName('Explore', 'scan the repo'), agentName('general-purpose'), agentName('other:helper')]).toEqual(['Planner', 'Api Guard', 'scan the repo', 'Agent', 'other:helper'])
  let id = 'x1'
  const list = [{ id: 'x1', description: '', type: 'general-purpose', status: 'running' }]
  const log = stand(on, { id: () => id })
  on('agent.list', async () => ({ value: list }) as never)
  // Found in the engine's list with no description: the Agent, as one started from the form is
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  await finish($, 'x1', 'REPORT: docs written')
  expect(log.notices.at(-1)?.title).toBe('Agent finished')
  // A spawn event for a row that is already there (it can come after the start that made the row) renames nothing
  id = 'x2'
  await $.agent.spawn(spawnEvent('Explore', 'scan the repo') as never)
  await $.agent.spawn(spawnEvent('Explore', 'other words') as never)
  await finish($, 'x2', 'REPORT: scanned')
  expect(log.notices.at(-1)?.title).toBe('scan the repo finished')
  // An expert's spawn event with no description: named as the expert, as the New agent form names its start
  id = 'x3'
  await $.agent.spawn(spawnEvent('cockpit:planner', '') as never)
  await finish($, 'x3', 'REPORT: three steps')
  expect(log.notices.at(-1)).toEqual({ title: 'Planner finished', text: 'three steps' })
})

// Fix 2
test('the agents graph says who started an agent and who provides it in the Agents tab\'s words', () => {
  const base = { task: 't', prompt: '', status: 'done' as const, startedAt: 1, tools: 0, log: [], cases: [], report: '' }
  const agents = [
    { ...base, id: 'p', name: 'Planner', type: 'cockpit:planner', by: 'pipeline' as const, provider: 'engine' },
    { ...base, id: 'c', name: 'scan', type: 'Explore', by: 'agent' as const, parent: 'p' },
    { ...base, id: 'o', name: 'help', type: 'other:helper', by: 'you' as const },
    { ...base, id: 'x', name: 'old', type: 'Plan' },
  ]
  const what = Object.fromEntries(agentGraph(agents as never).nodes.map(n => [n.name, n.what.split('\n').slice(2).join(' · ')]))
  expect(what['Planner']).toBe('started by a Cockpit pipeline · provided by Claude Code')
  expect(what['↗ scan']).toBe('started by the Planner · provided by Claude Code')
  expect(what['↗ help']).toBe('started by you · provided by other')
  expect(what['↗ old']).toBe("started by Claude, outside Cockpit's view · provided by Claude Code")
})

// Fix 3
test('a report is read one way everywhere: the last REPORT line counts, and a report with no such line is never mistaken for one', { timeoutMs: 20_000 }, async ($, on) => {
  // As parseReport reads an answer: the last line of its kind, the tag in any case
  const kept = parseReport('REPORT: first thought\nReport: the fix holds\nhandoff: try empty input')
  expect(kept).toBe('REPORT: the fix holds\nHANDOFF: try empty input')
  expect([reportPart(kept, 'REPORT'), reportPart(kept, 'HANDOFF')]).toEqual(['the fix holds', 'try empty input'])
  // A report kept before the rule, with two REPORT lines: every reader takes the last, as parseReport would
  expect(reportPart('REPORT: old\nREPORT: new', 'REPORT')).toBe('new')
  expect(recallOf({ report: 'REPORT: old\nREPORT: new', cases: [] } as never)).toBe('new')
  // A pipeline's kept report has the expert's name above
  expect(reportPart(`Prover:\n${kept}`, 'HANDOFF')).toBe('try empty input')
  // No REPORT (the — parseReport writes), or no such lines at all: nothing
  expect(reportPart(parseReport('HANDOFF: look at auth'), 'REPORT')).toBe('')
  expect(recallOf({ report: parseReport('HANDOFF: look at auth'), cases: [{ n: 'a', st: 'pass' }] } as never)).toBe('1/1 cases passed')
  expect(reportPart('it mentions REPORT: mid-line', 'REPORT')).toBe('')
  // The finish notice reads it the same way: an answer that only mentions REPORT: is told by its first line
  const log = stand(on)
  await $.agent.spawn(spawnEvent('Explore', 'look around') as never)
  await finish($, 'ag1', 'There is no REPORT: line in this answer\nall fine')
  expect(log.notices.at(-1)).toEqual({ title: 'look around finished', text: 'There is no REPORT: line in this answer' })
  // And one with only a HANDOFF says it is done, not "REPORT: —"
  await $.agent.spawn(spawnEvent('Explore', 'look again') as never)
  await finish($, 'ag2', 'HANDOFF: look at auth')
  expect(log.notices.at(-1)).toEqual({ title: 'look again finished', text: 'done' })
})

// Fix 4
test('an agent hand-off the engine drops is tried once more, as the codebase guide\'s is; dropped twice, it says it could not start', { timeoutMs: 20_000 }, async ($, on) => {
  const log = stand(on, { noVerdict: true, drops: 1 })
  const ui = await startFromForm($, 'cockpit:planner', 'plan the limiter')
  await settle()
  expect(log.tried.length).toBe(2)
  expect(log.taken[0]).toContain('▶ Start the Planner')
  expect(log.notes.join('\n')).not.toContain('could not start')
  await ui.unmount()
})
test('a hand-off dropped twice has failed, once', { timeoutMs: 20_000 }, async ($, on) => {
  const log = stand(on, { noVerdict: true, drops: 2 })
  const ui = await startFromForm($, 'cockpit:planner', 'plan the limiter')
  await settle()
  expect(log.tried.length).toBe(2)
  expect(log.notes.filter(n => n.includes('Planner could not start')).length).toBe(1)
  await ui.unmount()
})
// Fix 5
test('a worktree git still lists is not called removed, however git spells its path', { timeoutMs: 20_000 }, async ($, on) => {
  const wt = '/repo/.git/cockpit-worktrees/ag1700000000000-1'
  // git cannot remove it, and still lists it: with a slash at the end
  const log = stand(on, { listed: () => `worktree /repo\nHEAD head1\nbranch refs/heads/main\n\nworktree ${wt}/\nHEAD head1\nbranch refs/heads/cockpit/ag1700000000000-1\n` })
  // The kit hands a pane start no id: the spawn event names the worktree's folder, and the row is matched by it
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await openMore(ui)
  await ui.press({ key: 'spawn-toggle' })
  await ui.press({ key: 'spawn-wt' })
  await $.agent.spawn({ ...spawnEvent('general-purpose', 'tidy the docs'), cwd: wt } as never)
  await (ui as any).input({ key: 'spawn-task', text: 'tidy the docs', kind: 'change' })
  await ui.press({ key: 'spawn-go' })
  await finish($, 'ag1', 'REPORT: ok')
  await ui.press({ key: 'wt-rm-ag1' })
  await ui.press({ key: 'wt-yes-ag1' })
  await settle()
  expect(log.ran).toContain('git worktree prune')
  expect(log.toasts).toContain('◆ Not removed: fatal: no')
  expect(JSON.stringify(await ui.drawn())).not.toContain('removed, branch kept')
  await ui.unmount()
})

// Fix 6
test('the judges\' seats are one table: each judge is asked from its seat\'s point of view, and no panel is larger than the table', { timeoutMs: 20_000 }, async ($, on) => {
  expect(SEAT_NAMES).toEqual(SEATS.map(s => s.name))
  expect(SEATS.every(s => s.name && s.persona)).toBe(true)
  expect([nJ(0), nJ(5), nJ(10)]).toEqual([3, 6, Math.min(9, SEATS.length)])
  const log = stand(on, { score: 9 })
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{ question: 'Which cache?', header: 'Cache', multiSelect: false, options: [{ label: 'LRU', description: 'bounded' }, { label: 'None', description: 'simplest' }] }] } as never)
  // Seat by seat, in the table's order
  expect(log.systems.map(s => s.match(/^You are (.+) on a panel/)?.[1])).toEqual(SEATS.map(s => s.persona))
})

// Fix 7
test('which budget warning stands is one rule, for saving the settings and for warning', { timeoutMs: 20_000 }, async ($, on) => {
  const near = { day: '2026-11-09', level: 'near' as const, budget: 10 }
  const over = { ...near, level: 'over' as const }
  // Another session's warning stands when it is for a later day, or for today and this budget at this level or above
  expect(standingWarning(over, near)).toBe(over)
  expect(standingWarning(near, near)).toBe(near)
  expect(standingWarning({ ...near, day: '2026-11-10' }, over)).toEqual({ ...near, day: '2026-11-10' })
  expect(standingWarning(over, undefined)).toBe(over)
  // Ours stands when it is higher, for a later day, or for a different budget (a changed budget warns again)
  expect(standingWarning(near, over)).toBe(over)
  expect(standingWarning({ ...over, day: '2026-11-08' }, near)).toBe(near)
  expect(standingWarning({ ...over, budget: 20 }, near)).toBe(near)
  // What is in the store is taken only if it is a warning
  expect(standingWarning('x', near)).toBe(near)
  expect(standingWarning({ day: '2026-11-09', level: 'loud' }, undefined)).toBe(undefined)
  // Saving a setting never writes back what a hand-edited store held in a warning's place
  const log = stand(on, { prefs: { budgetWarned: 'x' } })
  await $.command.run({ command: 'cockpit', args: 'focus on' } as never)
  await $.command.run({ command: 'cockpit', args: 'focus off' } as never)
  expect(log.saved.length).toBeGreaterThan(0)
  expect(log.saved.every(p => p.budgetWarned === undefined)).toBe(true)
})

// Fix 9
test('a memory file that is there but cannot be read is listed as unreadable, not as missing', { timeoutMs: 20_000 }, async ($, on) => {
  // A reader that fails has not shown the file is gone
  const files = await resolveMemory(['/r/CLAUDE.md'], async p => { if (p === '/r/CLAUDE.md') return '@locked.md\n@gone.md'; if (p === '/r/locked.md') throw new Error('EACCES'); return null }, '')
  expect(files.map(f => `${f.path}${f.missing ? ' (missing)' : ''}${f.skipped ? ` [${f.skipped}]` : ''}`)).toEqual(['/r/CLAUDE.md', '/r/locked.md [unreadable]', '/r/gone.md (missing)'])
  // In the Rules tab: the import that exists but cannot be read, and the one that is not there
  stand(on, { disk: { '/repo/CLAUDE.md': '# Repo\n@locked.md\n@gone.md\n', '/repo/locked.md': 'secret' }, unreadable: ['/repo/locked.md'] })
  await $.command.run({ command: 'cockpit', args: 'tab rules' } as never)
  const ui = await $.ui.mount(pane as never)
  await openMore(ui)
  const d = JSON.stringify(await ui.drawn())
  expect(d).toContain('↳ locked.md')
  expect(d).toContain('unreadable, not read')
  expect(d).toContain('↳ gone.md')
  expect(d.match(/"missing"/g)?.length).toBe(1)
  await ui.unmount()
})
