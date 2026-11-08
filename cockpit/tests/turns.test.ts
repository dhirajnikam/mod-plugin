import { expect, test } from 'claude-code/testing'
import { AUTHOR, SNAPSHOT_PLAN, snapshot, turnRef, undoPlan } from '../hooks/turns'

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
