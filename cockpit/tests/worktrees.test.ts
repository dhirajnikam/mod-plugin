import { expect, test } from 'claude-code/testing'
import { WORKTREE_COMMANDS, applyRefusal, fillArgs, parseStat, worktreeFor } from '../hooks/worktrees'

test("a worktree's place, its changes and what will not apply are read from git's own output", () => {
  // Under the git folder, on a branch of its own, whatever the id holds; Windows paths made forward
  expect(worktreeFor('ag-12', '/repo/.git/cockpit-worktrees')).toEqual({ path: '/repo/.git/cockpit-worktrees/ag-12', branch: 'cockpit/ag-12', ref: 'refs/cockpit/worktrees/ag-12' })
  expect(worktreeFor('a b/c..d', 'C:\\r\\.git\\cockpit-worktrees\\')).toEqual({ path: 'C:/r/.git/cockpit-worktrees/a_b_c__d', branch: 'cockpit/a_b_c__d', ref: 'refs/cockpit/worktrees/a_b_c__d' })
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
  expect(applyRefusal('')).toEqual([])
})
