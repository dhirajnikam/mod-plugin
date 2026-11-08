import { expect, test } from 'claude-code/testing'
import { C_LOCALE, WORKTREE_COMMANDS, applyRefusal, fillArgs, parseStat, worktreeFor } from '../hooks/worktrees'

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

// A session that spawns from the Agents tab; git answers as a repository with a commit, or none (fresh)
function stand(on: any, opt: { fresh?: boolean } = {}) {
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
  on('agent.spawn', async (_: unknown, e: any) => (log.spawned.push({ type: e.subagentType, cwd: e.cwd }), { model: 'haiku', agentId: `ag${log.spawned.length}` }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (e.argv as string[]).join(' ')
    log.ran.push(`${cmd}${e.init?.cwd ? ` @${e.init.cwd}` : ''}`)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal: no' : '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    if (cmd === 'git rev-parse --verify -q HEAD') return opt.fresh ? out('', 1) : out('head1\n')
    if (cmd === 'git rev-parse --git-common-dir') return out('.git\n')
    if (cmd.startsWith('git status')) return out('## main\0')
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
  const wt = '/repo/.git/cockpit-worktrees/ag1700000000000'
  expect(log.ran).toContain(`git worktree add -q -b cockpit/ag1700000000000 ${wt} head1 @/repo`)
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
