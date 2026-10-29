import { expect, test } from 'claude-code/testing'

// git's own output for a repo with an edit, a deletion, a file staged earlier, a rename, a new folder and a name with a space
const STATUS = '## master...origin/master [ahead 2]\0 M a.txt\0 D gone.txt\0M  keep.txt\0R  new.txt\0old.txt\0?? newdir/\0?? with space.txt\0'
const NUMSTAT = '1\t0\ta.txt\x000\t1\tgone.txt\x001\t0\tkeep.txt\x000\t0\t\0old.txt\0new.txt\0'

const scroll = { offset: 0, bodyRows: 40 }
const PANE = { plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll, view: {} } }

test('the Git tab reads the repo and commits only the ticked files', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('prompt.submit', async (_, e) => ({ text: e.text }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async (_, e) => (toasts.push(String((e as { text?: unknown }).text ?? JSON.stringify(e))), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_, e) => {
    const argv = (e as unknown as { argv?: string[]; command?: string[] }).argv ?? (e as unknown as string[])
    const a = Array.isArray(argv) ? argv : Object.values(e as object).find(Array.isArray) as string[]
    ran.push(a)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal: nope' : '', isStdoutTruncated: false, isStderrTruncated: false } })
    const cmd = a.join(' ')
    if (cmd.startsWith('git status')) return out(STATUS)
    if (cmd.startsWith('git diff --numstat')) return out(NUMSTAT)
    if (cmd.startsWith('git branch')) return out('master\nfeature/x\n')
    if (cmd.startsWith('git symbolic-ref')) return out('', 1)
    if (cmd.startsWith('git rev-parse')) return out('abc1234\n')
    // The graph: a merge of feature/x into master, the branch's commit, and their shared root
    if (cmd.startsWith('git log --format=%h @{u}..HEAD')) return out('9e39bea\n')
    if (cmd.startsWith('git log')) return out(['9e39bea\x1f5c1d2e0 7a7a7a7\x1fHEAD -> master, tag: v1.0\x1ffix(cockpit): make the mod load\x1f2 days ago\x1fDev', '7a7a7a7\x1f2f5802f\x1forigin/feature/x, feature/x\x1fadd the x\x1f3 days ago\x1fDev', '5c1d2e0\x1f2f5802f\x1forigin/master\x1fpolish\x1f3 days ago\x1fDev', '2f5802f\x1f\x1f\x1ffeat(cockpit): add cockpit mod\x1f4 days ago\x1fDev'].join('\n') + '\n')
    if (cmd.startsWith('git show')) return out('Dev <dev@x.io>\n29 Oct 2026 10:00\n\nfix(cockpit): make the mod load\n\n a.ts | 3 ++-\n 1 file changed, 2 insertions(+), 1 deletion(-)')
    return out('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const ui = await $.ui.mount(PANE as never)
  // The setup runs once per repository: account, branch pattern, message pattern, commit mode, when
  for (const step of ['Account', 'Branch pattern', 'Message pattern', 'Commit mode', 'When']) {
    expect(JSON.stringify(await ui.drawn())).toContain(step)
    await ui.press({ key: step === 'When' ? 'setup-done' : 'setup-next' })
  }
  const drawn = JSON.stringify(await ui.drawn())
  // Branch, ahead, the rename and the default base are read from the repo
  expect(drawn).toContain('⎇ master')
  expect(drawn).toContain('↑2')
  expect(drawn).toContain('renamed')
  // The repository's own history as a graph: refs as chips, the merge's branch on a lane of its own
  expect(drawn).toContain('fix(cockpit): make the mod load')
  expect(drawn).toContain('2 days ago')
  expect(drawn).toContain(' ⎇ master ')
  expect(drawn).toContain(' ⌑ v1.0 ')
  expect(drawn).toContain(' ☁ origin/master ')
  expect(drawn).toContain(' ⎇ feature/x ')
  // Desktop draws each row as SVG: the merge's curve out to the branch's lane, and HEAD's ringed dot
  expect(drawn).toContain('<path d=')
  expect(drawn).toContain('r=\\"7\\"')
  expect(drawn).toContain('1 not pushed')
  // A press opens the commit: author, message, files
  await ui.press({ key: 'cm-9e39bea' })
  expect(JSON.stringify(await ui.drawn())).toContain('1 file changed')
  await ui.press({ key: 'cm-9e39bea' })
  expect(drawn).toContain('with space.txt')
  expect(drawn).not.toContain('"release"')

  // Untick keep.txt (staged earlier), give a subject, commit
  await ui.press({ key: 'stage-keep.txt' })
  // The subject comes from the last prompt
  await $.prompt.submit({ text: 'Tidy files', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  ran.length = 0
  await ui.press({ key: 'git-commit' })
  const commit = ran.find(a => a.includes('commit'))
  expect(commit).toBeDefined()
  const paths = commit!.slice(commit!.indexOf('--') + 1)
  expect(paths.sort()).toEqual(['a.txt', 'gone.txt', 'new.txt', 'newdir/', 'old.txt', 'with space.txt'])
  // The type is read from the task ("tidy" → refactor), the branch cut off master by the pattern
  expect(commit).toContain('refactor: tidy files')
  // A rename's old path is committed but never given to git add, which would refuse it
  expect(ran.find(a => a.includes('add'))).not.toContain('old.txt')
  expect(ran.some(a => a.join(' ').startsWith('git switch') && a.includes('refactor/tidy-files'))).toBe(true)
  expect(toasts.join(' ')).toContain('Committed abc1234')
  await ui.unmount()
})

test('a failed push says why', async ($, on) => {
  const toasts: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('prompt.submit', async (_, e) => ({ text: e.text }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async (_, e) => (toasts.push(JSON.stringify(e)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_, e) => {
    const a = Object.values(e as object).find(Array.isArray) as string[]
    const cmd = a.join(' ')
    const out = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out('## master\0 M a.txt\0')
    if (cmd.startsWith('git push')) return out('', 128, "fatal: 'origin' does not appear to be a git repository\n")
    if (cmd.startsWith('git rev-parse')) return out('abc1234\n')
    return out('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const ui = await $.ui.mount(PANE as never)
  await $.prompt.submit({ text: 'x', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  for (let i = 0; i < 4; i++) await ui.press({ key: 'setup-next' })
  await ui.press({ key: 'opt-push' })
  await ui.press({ key: 'setup-done' })
  await ui.press({ key: 'git-commit' })
  expect(toasts.join(' ')).toContain("push failed: fatal: 'origin' does not appear to be a git repository")
  await ui.unmount()
})
