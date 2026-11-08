import { expect, test } from 'claude-code/testing'
import { AUTHOR, LITERAL, SNAPSHOT_PLAN, snapshot, turnRef, undoPlan, undoTurn } from '../hooks/turns'

// A git that answers the plan's commands, recording each with the env it ran in
function fakeGit(hasHead: boolean, fail = '') {
  const ran: { argv: string; env: Record<string, string> }[] = []
  const run = async (argv: string[], env: Record<string, string>) => {
    const cmd = argv.join(' ')
    ran.push({ argv: cmd, env })
    if (fail && cmd.startsWith(fail)) return { exitCode: 128, stdout: '', stderr: 'fatal: broken\nmore' }
    if (cmd === 'git rev-parse --git-path cockpit-index') return { exitCode: 0, stdout: '.git/cockpit-index\n' }
    if (cmd === 'git rev-parse --verify -q HEAD') return hasHead ? { exitCode: 0, stdout: 'aaa111\n' } : { exitCode: 1, stdout: '' }
    if (cmd === 'git write-tree') return { exitCode: 0, stdout: 'tree222\n' }
    if (cmd.startsWith('git commit-tree')) return { exitCode: 0, stdout: 'commit333\n' }
    return { exitCode: 0, stdout: '' }
  }
  return { ran, run }
}

test('a snapshot is built on a temporary index and stored under its ref, never touching the real index, tree or branches', async () => {
  const g = fakeGit(true)
  expect(await snapshot('refs/cockpit/turns/f1/before', g.run)).toEqual({ commit: 'commit333', error: '' })
  const idx = { GIT_INDEX_FILE: '.git/cockpit-index' }
  expect(g.ran).toEqual([
    { argv: 'git rev-parse --git-path cockpit-index', env: {} },
    { argv: 'git rev-parse --verify -q HEAD', env: {} },
    { argv: 'git read-tree aaa111', env: idx },
    { argv: 'git add -A', env: idx },
    { argv: 'git write-tree', env: idx },
    { argv: 'git commit-tree tree222 -p aaa111 -m cockpit turn snapshot', env: AUTHOR },
    { argv: 'git update-ref refs/cockpit/turns/f1/before commit333', env: {} },
  ])
  // Every command that reads or writes an index names the temporary one; nothing checks out, resets, stashes or commits
  for (const r of g.ran) if (/read-tree|add|write-tree/.test(r.argv)) expect(r.env.GIT_INDEX_FILE).toBe('.git/cockpit-index')
  expect(g.ran.some(r => /checkout|reset|stash|switch|restore| commit |branch/.test(` ${r.argv} `))).toBe(false)
  // A repository with no commit yet: an empty start, and no parent
  const fresh = fakeGit(false)
  expect((await snapshot('refs/cockpit/turns/f2/before', fresh.run)).commit).toBe('commit333')
  expect(fresh.ran.map(r => r.argv)).toContain('git read-tree --empty')
  expect(fresh.ran.map(r => r.argv)).toContain('git commit-tree tree222 -m cockpit turn snapshot')
  expect(fresh.ran.some(r => r.argv.includes(' -p '))).toBe(false)
  // A step that fails stops it, says which and why, and stores no ref
  const broken = fakeGit(true, 'git add')
  expect(await snapshot('refs/cockpit/turns/f3/before', broken.run)).toEqual({ commit: '', error: 'git add failed: fatal: broken' })
  expect(broken.ran.some(r => r.argv.startsWith('git update-ref'))).toBe(false)
  // The plan stays valid JSON, as the real-git check reads it
  expect(JSON.parse(JSON.stringify(SNAPSHOT_PLAN))).toEqual(SNAPSHOT_PLAN)
  // Ref names: a flow id with anything git refuses is made safe
  expect(turnRef('f1700000000000', 'after')).toBe('refs/cockpit/turns/f1700000000000/after')
  expect(turnRef('a b..c~^:', 'before')).toBe('refs/cockpit/turns/a_b__c___/before')
})

test("undoing a turn restores what it changed or deleted, deletes what it created, and refuses when a file changed since", () => {
  // Modified, created, deleted; a rename shows as delete + add with --no-renames; odd names kept whole
  const ns = 'M\0src/a.ts\0A\0new.txt\0D\0gone.md\0D\0old/name.ts\0A\0new/name.ts\0M\0with space\ttab.txt\0'
  expect(undoPlan(ns, '')).toEqual({ restore: ['src/a.ts', 'gone.md', 'old/name.ts', 'with space\ttab.txt'], remove: ['new.txt', 'new/name.ts'], refuse: [] })
  // Changed since the turn ended: nothing restored or deleted, and the files named
  expect(undoPlan(ns, 'src/a.ts\0new.txt\0')).toEqual({ restore: [], remove: [], refuse: ['src/a.ts', 'new.txt'] })
  // A turn that changed nothing undoes nothing
  expect(undoPlan('', '')).toEqual({ restore: [], remove: [], refuse: [] })
})

test('undoTurn takes away what the turn created (git clean, or restore when tracked) and the folders it emptied, then restores the rest; a later edit refuses', async () => {
  const steps: string[] = []
  let since = ''
  const run = async (argv: string[], env: Record<string, string>, stdin?: string) => {
    const cmd = argv.join(' ')
    steps.push(`${cmd}${stdin !== undefined ? ` <${stdin.split('\0').join('|')}>` : ''}${env.GIT_LITERAL_PATHSPECS ? ' [literal]' : ''}`)
    if (cmd.startsWith('git diff --name-status')) return { exitCode: 0, stdout: 'M\0a.txt\0A\0src/deep/new.ts\0A\0committed.ts\0D\0gone.md\0' }
    if (cmd.startsWith('git diff --name-only')) return { exitCode: 0, stdout: since }
    // committed.ts was auto-committed after the turn: it is tracked now
    if (cmd === 'git ls-files -z') return { exitCode: 0, stdout: 'a.txt\0committed.ts\0' }
    if (cmd === 'git write-tree') return { exitCode: 0, stdout: 'tree\n' }
    if (cmd.startsWith('git commit-tree')) return { exitCode: 0, stdout: 'now9\n' }
    if (cmd.startsWith('git rev-parse --git-path')) return { exitCode: 0, stdout: '.git/cockpit-index\n' }
    if (cmd.startsWith('git rev-parse --verify')) return { exitCode: 0, stdout: 'h\n' }
    return { exitCode: 0, stdout: '' }
  }
  // src/deep empties when new.ts goes; src still holds other files
  const isEmpty = async (d: string) => d === 'src/deep'
  expect(await undoTurn('b1', 'a1', 'refs/cockpit/turns/f/undone', run, isEmpty)).toEqual({ done: true, restore: ['a.txt', 'gone.md'], remove: ['src/deep/new.ts', 'committed.ts'], refuse: [], error: '' })
  expect(steps.filter(x => /^git (update-ref|diff --name-only|clean|restore)/.test(x))).toEqual([
    // The tree as it is now kept first, so the undo can be undone
    'git update-ref refs/cockpit/turns/f/undone now9',
    'git diff --name-only --no-renames -z a1 now9',
    'git clean -f -q -- src/deep/new.ts [literal]',
    'git clean -d -f -q -- src/deep/ [literal]',
    // The tracked created file goes with the restore (it is not in before), files on standard input, read literally
    'git restore --source=b1 --worktree --pathspec-from-file=- --pathspec-file-nul <a.txt|gone.md|committed.ts> [literal]',
  ])
  expect(LITERAL).toEqual({ GIT_LITERAL_PATHSPECS: '1' })
  // A later change to another file does not matter; one to the turn's own files refuses, removing and restoring nothing
  steps.length = 0
  since = 'unrelated.txt\0'
  expect((await undoTurn('b1', 'a1', 'u', run, isEmpty)).done).toBe(true)
  steps.length = 0
  since = 'unrelated.txt\0a.txt\0'
  expect(await undoTurn('b1', 'a1', 'u', run, isEmpty)).toEqual({ done: false, restore: [], remove: [], refuse: ['a.txt'], error: '' })
  expect(steps.some(x => /^git (clean|restore)/.test(x))).toBe(false)
  // Hundreds of created files go 100 a command
  const many = Array.from({ length: 250 }, (_, i) => `A\0f${i}.txt\0`).join('')
  steps.length = 0
  since = ''
  const runMany = async (argv: string[], env: Record<string, string>, stdin?: string) => (argv.join(' ').startsWith('git diff --name-status') ? { exitCode: 0, stdout: many } : run(argv, env, stdin))
  await undoTurn('b1', 'a1', 'u', runMany, isEmpty)
  expect(steps.filter(x => x.startsWith('git clean -f')).map(x => x.split(' ').length - 6)).toEqual([100, 100, 50])
})

// A session whose git answers the snapshot plan; repo false: not a repository at all
function session(on: any, opt: { repo?: boolean; refs?: string } = {}) {
  const ran: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 + ran.length }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 0 } } }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (e.argv as string[]).join(' ')
    ran.push(`${cmd}${e.init?.env?.GIT_INDEX_FILE ? ' [temp index]' : ''}${e.init?.cwd ? ` @${e.init.cwd}` : ''}`)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal: not a git repository' : '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (opt.repo === false && cmd.startsWith('git')) return out('', 128)
    if (cmd.startsWith('git status')) return out('## main\0')
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    if (cmd === 'git rev-parse --git-path cockpit-index') return out('.git/cockpit-index\n')
    if (cmd.startsWith('git rev-parse --verify -q refs/cockpit')) return out('', 1)
    if (cmd === 'git rev-parse --verify -q HEAD') return out('head1\n')
    if (cmd === 'git write-tree') return out('tree1\n')
    if (cmd.startsWith('git commit-tree')) return out(`snap${ran.length}\n`)
    if (cmd.startsWith('git for-each-ref')) return out(opt.refs ?? '')
    return out('')
  })
  return ran
}
// A prompt, and the turn the engine starts for it
const prompt = async ($: any, text: string) => {
  await $.prompt.submit({ text, command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  // Cockpit's hook runs first; the engine's own turn, which the kit does not stand in for, is not needed
  await $.turn.start({ text, turnId: `t-${text}` } as never).catch(() => null)
}
const done = ($: any, turnId: string) => $.turn.complete({ answer: 'ok', reason: 'answer', turnId, isAborted: false, durationMs: 1000 } as never)

test('every turn is snapshot before Claude starts and after it ends, on the temporary index from the top folder', async ($, on) => {
  const ran = session(on)
  await prompt($, 'fix the login')
  const beforeAt = ran.findIndex(r => /update-ref refs\/cockpit\/turns\/f\d+\/before/.test(r))
  expect(beforeAt).toBeGreaterThan(-1)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e1' } as never)
  await done($, 't1')
  const refs = ran.filter(r => r.includes('update-ref refs/cockpit/turns/'))
  const flow = refs[0]!.match(/turns\/(f\d+)\//)![1]
  expect(refs.map(r => r.replace(/ snap\d+/, '').replace(/ @\/repo/, ''))).toEqual([`git update-ref refs/cockpit/turns/${flow}/before`, `git update-ref refs/cockpit/turns/${flow}/after`])
  // Every index step on the temporary index, every step from the top folder
  for (const r of ran.filter(x => /git (read-tree|add -A$|add -A @|write-tree)/.test(x))) expect(r).toContain('[temp index]')
  for (const r of ran.filter(x => x.includes('refs/cockpit'))) expect(r).toContain('@/repo')
  // A second prompt is a new turn with its own pair
  await prompt($, 'now the signup')
  await done($, 't2')
  expect(new Set(ran.filter(r => r.includes('update-ref refs/cockpit/turns/')).map(r => r.match(/turns\/(f\d+)\//)![1])).size).toBe(2)
})

test('only the newest 50 turns keep their snapshots, and no branch is touched', async ($, on) => {
  // 52 turns' refs, newest first: the two oldest go, both their refs, and no branch is touched
  // In git's own order (by name), which is not the flows' age
  const refs = Array.from({ length: 52 }, (_, i) => `refs/cockpit/turns/f${49 + i}/after\nrefs/cockpit/turns/f${49 + i}/before`).join('\n') + '\n'
  const ran = session(on, { refs })
  await prompt($, 'fix it')
  await done($, 't1')
  expect(ran.filter(r => r.startsWith('git update-ref -d')).map(r => r.replace(/ @\/repo/, ''))).toEqual([
    'git update-ref -d refs/cockpit/turns/f49/after',
    'git update-ref -d refs/cockpit/turns/f49/before',
    'git update-ref -d refs/cockpit/turns/f50/after',
    'git update-ref -d refs/cockpit/turns/f50/before',
  ])
  expect(ran.some(r => /update-ref -d refs\/heads/.test(r))).toBe(false)
})

test('outside a git repository no snapshot is taken', async ($, on) => {
  const ran = session(on, { repo: false })
  await prompt($, 'fix it')
  await done($, 't1')
  expect(ran.some(r => r.includes('update-ref') || r.includes('commit-tree'))).toBe(false)
})
