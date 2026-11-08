import { expect, test } from 'claude-code/testing'
import { C_LOCALE, WORKTREE_COMMANDS, applyRefusal, fillArgs, parseStat, pickIsolated, worktreeFor } from '../hooks/worktrees'

test("a worktree's place, its changes and what will not apply are read from git's own output", () => {
  // Under the git folder, on a branch of its own, whatever the id holds; Windows paths made forward
  expect(worktreeFor('ag-12', '/repo/.git')).toEqual({ path: '/repo/.git/cockpit-worktrees/ag-12', branch: 'cockpit/ag-12', ref: 'refs/cockpit/worktrees/ag-12' })
  expect(worktreeFor('a b/c..d', 'C:\\r\\.git\\')).toEqual({ path: 'C:/r/.git/cockpit-worktrees/a_b_c__d', branch: 'cockpit/a_b_c__d', ref: 'refs/cockpit/worktrees/a_b_c__d' })
  // Under the common git folder, the main repository's even from a linked worktree
  expect(WORKTREE_COMMANDS.common).toEqual(['git', 'rev-parse', '--git-common-dir'])
  expect(C_LOCALE).toEqual({ LC_ALL: 'C', LANGUAGE: 'C' })
  // The commands, filled; the add starts from the base commit
  expect(fillArgs(WORKTREE_COMMANDS.add, { branch: 'cockpit/x', path: '/p', base: 'abc' })).toEqual(['git', 'worktree', 'add', '-q', '-b', 'cockpit/x', '/p', 'abc'])
  expect(JSON.parse(JSON.stringify(WORKTREE_COMMANDS))).toEqual(WORKTREE_COMMANDS)
  // Nothing that writes the index: apply and check work on files only
  expect(WORKTREE_COMMANDS.apply.includes('--index') || WORKTREE_COMMANDS.apply.includes('--cached') || WORKTREE_COMMANDS.apply.includes('--3way')).toBe(false)
  // numstat: lines, a binary file, a name with a tab and a newline; an empty diff
  expect(parseStat('3\t1\tsrc/a.ts\0-\t-\tlogo.png\0' + '2\t0\todd\tname\nx.md\0')).toEqual({ files: ['src/a.ts', 'logo.png', 'odd\tname\nx.md'], add: 5, del: 1 })
  expect(parseStat('')).toEqual({ files: [], add: 0, del: 0 })
  // What git apply --check names: a failed hunk, a file already there, one gone
  expect(applyRefusal('error: patch failed: src/a.ts:12\nerror: src/a.ts: patch does not apply\nerror: new.txt: already exists in working directory\nerror: gone.md: No such file or directory\nsomething else')).toEqual(['src/a.ts', 'new.txt', 'gone.md'])
  // Binary patches, a quoted name, and any other error kept whole so a refusal always says something
  expect(applyRefusal("error: cannot apply binary patch to 'logo.png' without full index line\nerror: binary patch does not apply to 'icon.ico'")).toEqual(['logo.png', 'icon.ico'])
  expect(applyRefusal('error: "a\\tb.txt": already exists in working directory')).toEqual(['a\tb.txt'])
  expect(applyRefusal('error: corrupt patch at line 7')).toEqual(['corrupt patch at line 7'])
  expect(applyRefusal('')).toEqual([])
})

test("pickIsolated takes Claude Code's new worktree for an agent: not one there before, held by another agent, or made by Cockpit", () => {
  const list = [
    { path: '/repo', branch: 'main' },
    { path: '/repo/.git/cockpit-worktrees/ag1-1', branch: 'cockpit/ag1-1' },
    { path: '/tmp/someone-else', branch: 'feature' },
    { path: '/repo/.claude/worktrees/agent-a1', branch: 'worktree-agent-a1', head: 'h1' },
    { path: '/repo/.claude/worktrees/agent-a2', branch: 'worktree-agent-a2', head: 'h1' },
  ]
  // Claude Code's own place before a worktree made elsewhere meanwhile
  expect(pickIsolated(list, ['/repo'], [])?.path).toBe('/repo/.claude/worktrees/agent-a1')
  // Not one another agent holds
  expect(pickIsolated(list, ['/repo'], ['/repo/.claude/worktrees/agent-a1'])?.path).toBe('/repo/.claude/worktrees/agent-a2')
  // Not one there before, Windows slashes and trailing slashes alike
  expect(pickIsolated(list, ['\\repo', '/repo/.claude/worktrees/agent-a1/'], ['/repo/.claude/worktrees/agent-a2'])?.path).toBe('/tmp/someone-else')
  // Never one Cockpit made; none at all when nothing is new
  expect(pickIsolated([list[0]!, list[1]!], ['/repo'], [])).toBe(null)
})

// A session that spawns from the Agents tab; git answers as a repository with a commit, or none (fresh)
function stand(on: any, opt: { fresh?: boolean; deny?: boolean; clash?: () => boolean; gone?: () => boolean } = {}) {
  const log = { ran: [] as string[], spawned: [] as { type: string; cwd?: string }[], toasts: [] as string[] }
  on('clock.now', async () => ({ value: 1_700_000_000_000 }))
  on('ui.toast', async (_: unknown, e: any) => (log.toasts.push(String(e.text)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('tool.check', async () => ({ decision: 'allow' }) as never)
  on('agent.spawn', async (_: unknown, e: any) => (log.spawned.push({ type: e.subagentType, cwd: e.cwd }), opt.deny ? { deny: 'refused by a rule' } : { model: 'haiku', agentId: `ag${log.spawned.length}` }))
  on('turn.complete', async () => ({ text: '' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 0 } } }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (e.argv as string[]).join(' ')
    log.ran.push(`${cmd}${e.init?.cwd ? ` @${e.init.cwd}` : ''}`)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal: no' : '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    if (cmd === 'git rev-parse --verify -q HEAD') return opt.fresh ? out('', 1) : out('head1\n')
    if (cmd === 'git rev-parse --git-common-dir') return out('.git\n')
    if (cmd.startsWith('git status')) return out('## main\0')
    // A worktree deleted by hand: git cannot remove it, and lists only the main one
    if (opt.gone?.() && cmd.startsWith('git worktree remove')) return out('', 128)
    if (cmd.startsWith('git worktree list')) return out('worktree /repo\n')
    if (cmd === 'git rev-parse --git-path cockpit-index') return out('.git/cockpit-index\n')
    if (cmd === 'git write-tree') return out('tree1\n')
    if (cmd.startsWith('git commit-tree')) return out('snap1\n')
    if (cmd.startsWith('git diff --numstat')) return out('2\t1\tsrc/a.ts\0')
    if (cmd.startsWith('git diff --binary')) return out('diff --git a/src/a.ts b/src/a.ts\n')
    if (cmd.startsWith('git apply --check')) return opt.clash?.() ? { value: { exitCode: 1, stdout: '', stderr: 'error: patch failed: src/a.ts:3\nerror: src/a.ts: patch does not apply', isStdoutTruncated: false, isStderrTruncated: false } } : out('')
    return out('')
  })
  return log
}
const pane = { plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} } }

test('ticked In its own worktree, an agent from the New agent form runs in a worktree Cockpit makes from HEAD on a branch of its own', async ($, on) => {
  const log = stand(on)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'spawn-toggle' })
  expect(JSON.stringify(await ui.drawn())).toContain('In its own worktree')
  await ui.press({ key: 'spawn-wt' })
  await (ui as any).input({ key: 'spawn-task', text: 'tidy the docs', kind: 'change' })
  await ui.press({ key: 'spawn-go' })
  const wt = '/repo/.git/cockpit-worktrees/ag1700000000000-1'
  expect(log.ran).toContain(`git worktree add -q -b cockpit/ag1700000000000-1 ${wt} head1 @/repo`)
  expect(log.spawned.at(-1)?.cwd).toBe(wt)
  // The tick also sits beside Team runs, the same setting
  expect(JSON.stringify(await ui.drawn())).toContain('Runs in their own worktree')
  await ui.unmount()
})

test('with the tick off, or no commit to start a worktree from, the agent runs in your tree, and a toast says why', async ($, on) => {
  const log = stand(on, { fresh: true })
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'spawn-toggle' })
  // Off: no worktree, no cwd
  await (ui as any).input({ key: 'spawn-task', text: 'first', kind: 'change' })
  await ui.press({ key: 'spawn-go' })
  expect(log.ran.some(r => r.startsWith('git worktree add'))).toBe(false)
  expect(log.spawned.at(-1)?.cwd).toBe(undefined)
  // On, but the repository has no commit yet
  await ui.press({ key: 'spawn-toggle' })
  await ui.press({ key: 'spawn-wt' })
  await (ui as any).input({ key: 'spawn-task', text: 'second', kind: 'change' })
  await ui.press({ key: 'spawn-go' })
  expect(log.ran.some(r => r.startsWith('git worktree add'))).toBe(false)
  expect(log.spawned.at(-1)?.cwd).toBe(undefined)
  expect(log.toasts.join('\n')).toContain('Runs in your tree: the repository has no commit yet')
  await ui.unmount()
})

test('a start that is refused leaves no worktree or branch behind, and a pipeline never gets a worktree', async ($, on) => {
  const log = stand(on, { deny: true })
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'spawn-toggle' })
  await ui.press({ key: 'spawn-wt' })
  await (ui as any).input({ key: 'spawn-task', text: 'refused one', kind: 'change' })
  await ui.press({ key: 'spawn-go' })
  const made = log.ran.find(r => r.startsWith('git worktree add'))!
  const [, , , , , branch, path] = made.split(' ')
  expect(log.ran).toContain(`git worktree remove --force ${path} @/repo`)
  // The safe delete: it refuses a branch with a commit of its own
  expect(log.ran).toContain(`git branch -d ${branch} @/repo`)
  await ui.unmount()
})

test("a pipeline's experts work in your tree whatever the tick says", async ($, on) => {
  const log = stand(on)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'team-wt' })
  await $.command.run({ command: 'cockpit', args: 'test' } as never)
  expect(log.spawned.length).toBeGreaterThan(0)
  expect(log.ran.some(r => r.startsWith('git worktree add'))).toBe(false)
  expect(log.spawned.every(x => x.cwd === undefined)).toBe(true)
  await ui.unmount()
})

test("a worktree agent's row shows what it changed; Bring back and Remove each ask first, a clash changes nothing, and the branch is kept", async ($, on) => {
  let clash = false
  const log = stand(on, { clash: () => clash })
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'spawn-toggle' })
  await ui.press({ key: 'spawn-wt' })
  await (ui as any).input({ key: 'spawn-task', text: 'refactor the login', kind: 'change' })
  await ui.press({ key: 'spawn-go' })
  const wt = '/repo/.git/cockpit-worktrees/ag1700000000000-1'
  // The engine's own spawn event for it, naming the folder it runs in (the kit hands no id back to Cockpit's start)
  await $.agent.spawn({ tool_use_id: 's1', prompt: 'refactor the login', description: 'refactor the login', subagentType: 'general-purpose', cwd: wt, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'x', background: true, fork: false } as never)
  // It finishes: its worktree is snapshotted inside the worktree and compared with where it started
  await $.turn.complete({ agentId: 'ag2', answer: 'REPORT: done', reason: 'answer', turnId: 'x', isAborted: false, durationMs: 1000 } as never)
  expect(log.ran).toContain(`git add -A @${wt}`)
  expect(log.ran).toContain('git diff --numstat --no-renames -z head1 snap1 @/repo')
  let d = JSON.stringify(await ui.drawn())
  expect(d).toContain('⎇ cockpit/ag1700000000000-1 · 1 file +2 −1')
  // Bring back: asks, and nothing applies before the confirm
  const mark = log.ran.length
  await ui.press({ key: 'wt-back-ag2' })
  expect(JSON.stringify(await ui.drawn())).toContain('Apply its changes to your files?')
  expect(log.ran.slice(mark).some(r => r.startsWith('git apply'))).toBe(false)
  await ui.press({ key: 'wt-no-ag2' })
  // A clash with your own changes: refused, naming the file, nothing applied
  clash = true
  await ui.press({ key: 'wt-back-ag2' })
  await ui.press({ key: 'wt-yes-ag2' })
  expect(log.ran.some(r => r === 'git apply --whitespace=nowarn - @/repo')).toBe(false)
  expect(log.toasts.join('\n')).toContain('Not brought back, nothing changed: src/a.ts')
  // No clash: checked, then applied to your files only
  clash = false
  await ui.press({ key: 'wt-back-ag2' })
  await ui.press({ key: 'wt-yes-ag2' })
  expect(log.ran).toContain('git apply --check --whitespace=nowarn - @/repo')
  expect(log.ran).toContain('git apply --whitespace=nowarn - @/repo')
  expect(log.toasts.join('\n')).toContain('Brought back: 1 file +2 −1 from cockpit/ag1700000000000-1')
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('brought back')
  expect(d).not.toContain('wt-back-ag2')
  // Remove: asks, then removes the worktree and keeps its branch
  await ui.press({ key: 'wt-rm-ag2' })
  expect(JSON.stringify(await ui.drawn())).toContain('Remove the worktree (its branch stays)?')
  await ui.press({ key: 'wt-yes-ag2' })
  expect(log.ran).toContain(`git worktree remove --force ${wt} @/repo`)
  expect(log.ran.some(r => r.startsWith('git branch -d'))).toBe(false)
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('removed, branch kept')
  expect(d).not.toContain('wt-rm-ag2')
  await ui.unmount()
})

test('a worktree whose spawn event came before its start returned, and one deleted by hand, are still handled', async ($, on) => {
  let gone = false
  const log = stand(on, { gone: () => gone })
  // The engine's spawn event for the worktree's folder arrives first (the start hands no id back)
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'spawn-toggle' })
  await ui.press({ key: 'spawn-wt' })
  const wt = '/repo/.git/cockpit-worktrees/ag1700000000000-1'
  await $.agent.spawn({ tool_use_id: 'early', prompt: 'p', description: 'early one', subagentType: 'general-purpose', cwd: wt.replace(/\//g, '\\'), provider: { plugin: 'engine', tier: 'core' }, parentModel: 'x', background: true, fork: false } as never)
  await (ui as any).input({ key: 'spawn-task', text: 'early one', kind: 'change' })
  await ui.press({ key: 'spawn-go' })
  await $.turn.complete({ agentId: 'ag1', answer: 'REPORT: ok', reason: 'answer', turnId: 'y', isAborted: false, durationMs: 1000 } as never)
  // Matched by its folder, Windows slashes and all: the row is there with what it changed
  expect(JSON.stringify(await ui.drawn())).toContain('⎇ cockpit/ag1700000000000-1 · 1 file +2 −1')
  // Deleted by hand: Remove prunes git's record and, with git listing it no more, the row says removed
  gone = true
  await ui.press({ key: 'wt-rm-ag1' })
  await ui.press({ key: 'wt-yes-ag1' })
  expect(log.ran).toContain('git worktree prune @/repo')
  expect(JSON.stringify(await ui.drawn())).toContain('removed, branch kept')
  await ui.unmount()
})

test("ticked, an agent runs in Claude Code's own worktree isolation through its isolated twin, and Cockpit finds that worktree", async ($, on) => {
  const registered: { name: string; isolation?: string }[] = []
  const log = { ran: [] as string[], spawned: [] as { type: string; cwd?: string }[] }
  on('clock.now', async () => ({ value: 1_700_000_000_000 }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('command.register', async () => ({ value: {} }) as never)
  on('clock.every', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('tool.check', async () => ({ decision: 'allow' }) as never)
  on('fs.list', async () => ({ value: [] }) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('agent.register', async (_: unknown, e: any) => (registered.push({ name: e.name, isolation: e.isolation }), { value: { agent: `cockpit:${e.name}` } }))
  // A registered agent's start arrives in the Agent tool's own shape (subagent_type)
  on('agent.spawn', async (_: unknown, e: any) => (log.spawned.push({ type: e.subagentType ?? e.subagent_type, cwd: e.cwd }), { model: 'haiku', agentId: `ag${log.spawned.length}` }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (e.argv as string[]).join(' ')
    log.ran.push(cmd)
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    if (cmd === 'git rev-parse --verify -q HEAD') return out('head1\n')
    if (cmd === 'git rev-parse --git-common-dir') return out('.git\n')
    // Claude Code makes the twin's worktree once it starts
    if (cmd === 'git worktree list --porcelain') return out(`worktree /repo\nHEAD head1\nbranch refs/heads/main\n${log.spawned.some(s => s.type.endsWith('-in-worktree')) ? '\nworktree /repo/.claude/worktrees/agent-a1\nHEAD head1\nbranch refs/heads/worktree-agent-a1\n' : ''}`)
    return out('')
  })
  // The twins register at session start, each with Claude Code's own isolation
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  expect(registered).toContainEqual({ name: 'agent-in-worktree', isolation: 'worktree' })
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'spawn-toggle' })
  await ui.press({ key: 'spawn-wt' })
  await (ui as any).input({ key: 'spawn-task', text: 'tidy the docs', kind: 'change' })
  await ui.press({ key: 'spawn-go' })
  // Started as the isolated twin: Claude Code makes the worktree, Cockpit makes none
  expect(log.spawned.at(-1)).toEqual({ type: 'cockpit:agent-in-worktree', cwd: undefined })
  expect(log.ran.some(r => r.startsWith('git worktree add'))).toBe(false)
  // The engine's spawn event records the agent; Cockpit finds Claude Code's worktree and shows its branch
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'tidy the docs', description: 'tidy the docs', subagentType: 'cockpit:agent-in-worktree', provider: { plugin: 'cockpit', tier: 'user' }, parentModel: 'x', background: true, fork: false } as never)
  await $.turn.complete({ agentId: 'ag2', answer: 'REPORT: ok', reason: 'answer', turnId: 'z', isAborted: false, durationMs: 1000 } as never)
  expect(JSON.stringify(await ui.drawn())).toContain('⎇ worktree-agent-a1')
  // Another plugin's type, which Cockpit cannot redefine: a worktree Cockpit makes itself
  await ui.press({ key: 'spawn-toggle' })
  await (ui as any).input({ key: 'spawn-type-custom', text: 'other:helper', kind: 'change' })
  await (ui as any).input({ key: 'spawn-task', text: 'help out', kind: 'change' })
  await ui.press({ key: 'spawn-go' })
  expect(log.ran.some(r => r.startsWith('git worktree add -q -b cockpit/'))).toBe(true)
  expect(log.spawned.at(-1)?.type).toBe('other:helper')
  await ui.unmount()
})

// A session where the twins register at start and Claude Code makes a worktree for each twin it starts (made: which)
function twinStand(on: any, made: (spawnedTwins: number) => string[]) {
  const log = { ran: [] as string[], spawned: [] as { type: string; cwd?: string }[], registered: [] as { name: string; isolation?: string }[] }
  on('clock.now', async () => ({ value: 1_700_000_000_000 }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('command.register', async () => ({ value: {} }) as never)
  on('clock.every', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('model.complete', async () => ({ value: { isAnswered: true, text: '{"name": "docs-writer", "description": "Writes the docs", "prompt": "You write docs.", "tools": ["Read"]}', usage: { inputTokens: 1, outputTokens: 1 } } }) as never)
  on('tool.check', async () => ({ decision: 'allow' }) as never)
  on('fs.list', async () => ({ value: [] }) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('agent.register', async (_: unknown, e: any) => (log.registered.push({ name: e.name, isolation: e.isolation }), { value: { agent: `cockpit:${e.name}` } }))
  on('agent.spawn', async (_: unknown, e: any) => (log.spawned.push({ type: e.subagentType ?? e.subagent_type, cwd: e.cwd }), { model: 'haiku', agentId: `ag${log.spawned.length}` }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (e.argv as string[]).join(' ')
    log.ran.push(cmd)
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    if (cmd === 'git rev-parse --verify -q HEAD') return out('head1\n')
    if (cmd === 'git worktree list --porcelain') {
      const twins = log.spawned.filter(s => String(s.type).endsWith('-in-worktree')).length
      return out(['worktree /repo\nHEAD head1\nbranch refs/heads/main', ...made(twins).map(p => `worktree ${p}\nHEAD c1a0de\nbranch refs/heads/worktree-${p.split('/').pop()}`)].join('\n\n') + '\n')
    }
    if (cmd === 'git rev-parse --git-path cockpit-index') return out('.git/cockpit-index\n')
    if (cmd === 'git write-tree') return out('tree1\n')
    if (cmd.startsWith('git commit-tree')) return out('snap1\n')
    if (cmd.startsWith('git diff --numstat')) return out('1\t0\tx.ts\0')
    return out('')
  })
  return log
}
const engineSpawn = ($: any, type: string, id: string) => $.agent.spawn({ tool_use_id: id, prompt: id, description: id, subagentType: type, provider: { plugin: 'cockpit', tier: 'user' }, parentModel: 'x', background: true, fork: false } as never)
const finish = ($: any, agentId: string) => $.turn.complete({ agentId, answer: 'REPORT: ok', reason: 'answer', turnId: agentId, isAborted: false, durationMs: 1000 } as never)
const start = async ($: any, ui: any, task: string) => {
  await (ui as any).input({ key: 'spawn-task', text: task, kind: 'change' })
  await ui.press({ key: 'spawn-go' })
}

test("a twin is shown as the agent it is, Rerun starts its twin again with no worktree of Cockpit's, and its base is the worktree's own", async ($, on) => {
  const log = twinStand(on, n => (n ? ['/repo/.claude/worktrees/agent-a1'] : []))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'spawn-toggle' })
  await ui.press({ key: 'spawn-wt' })
  await start($, ui, 'tidy the docs')
  await engineSpawn($, 'cockpit:agent-in-worktree', 'e1')
  await finish($, 'ag2')
  const d = JSON.stringify(await ui.drawn())
  // Its own type and name, not the twin's
  expect(d).not.toContain('agent-in-worktree')
  expect(d).toContain('⎇ worktree-agent-a1 · 1 file +1 −0')
  // The base is the worktree's own HEAD from git's list, not this checkout's
  expect(log.ran).toContain('git diff --numstat --no-renames -z c1a0de snap1')
  // Rerun: its twin again, and no worktree Cockpit makes
  const mark = log.spawned.length
  await ui.press({ key: 'restart-ag2' })
  expect(log.spawned.slice(mark).map(s => s.type)).toEqual(['cockpit:agent-in-worktree'])
  expect(log.ran.some(r => r.startsWith('git worktree add'))).toBe(false)
  await ui.unmount()
})

test('two twins started together each get their own worktree, a foreign one is left alone, and one that changed nothing shows no ghost', async ($, on) => {
  // Each twin's worktree appears once it starts, beside one another session made meanwhile; the third twin changes nothing
  const log = twinStand(on, n => ['/tmp/another-session', ...(n >= 1 ? ['/repo/.claude/worktrees/agent-a1'] : []), ...(n >= 2 ? ['/repo/.claude/worktrees/agent-a2'] : [])])
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'spawn-toggle' })
  await ui.press({ key: 'spawn-wt' })
  await start($, ui, 'one')
  await ui.press({ key: 'spawn-toggle' })
  await start($, ui, 'two')
  await ui.press({ key: 'spawn-toggle' })
  await start($, ui, 'three')
  await engineSpawn($, 'cockpit:agent-in-worktree', 'e1')
  await engineSpawn($, 'cockpit:agent-in-worktree', 'e2')
  await engineSpawn($, 'cockpit:agent-in-worktree', 'e3')
  await finish($, 'ag4')
  await finish($, 'ag5')
  await finish($, 'ag6')
  const d = JSON.stringify(await ui.drawn())
  expect(d).toContain('⎇ worktree-agent-a1')
  expect(d).toContain('⎇ worktree-agent-a2')
  expect(d).not.toContain('another-session')
  // The third's worktree never showed: it changed nothing, and offers nothing to bring back or remove
  expect(d).toContain('changed nothing (Claude Code removed its worktree)')
  expect(d).not.toContain('wt-back-ag6')
  expect(d).not.toContain('wt-rm-ag6')
  expect(log.spawned.filter(s => s.type === 'cockpit:agent-in-worktree').length).toBe(6)
  await ui.unmount()
})

test('an agent made now gets its twin at once, so it can run in a worktree of its own this session', async ($, on) => {
  const log = twinStand(on, () => [])
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const ui = await $.ui.mount(pane as never)
  await ui.press({ key: 'spawn-toggle' })
  await (ui as any).input({ key: 'describe', text: 'writes the docs for each change', kind: 'change' })
  await ui.press({ key: 'describe-go' })
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  expect(log.registered).toContainEqual({ name: 'docs-writer', isolation: undefined })
  expect(log.registered).toContainEqual({ name: 'docs-writer-in-worktree', isolation: 'worktree' })
  await ui.unmount()
})
