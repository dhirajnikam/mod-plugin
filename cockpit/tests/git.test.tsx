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
    return out('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const ui = await $.ui.mount(PANE as never)
  const drawn = JSON.stringify(await ui.drawn())
  // Branch, ahead, the rename and the default base are read from the repo
  expect(drawn).toContain('⎇ master')
  expect(drawn).toContain('↑2')
  expect(drawn).toContain('renamed')
  expect(drawn).toContain('with space.txt')
  expect(drawn).not.toContain('"release"')

  // Untick keep.txt (staged earlier), give a subject, commit
  await ui.press({ key: 'stage-keep.txt' })
  await (ui as never as { input: (t: object) => Promise<unknown> }).input({ key: 'git-subject', text: 'tidy files' } as never)
  ran.length = 0
  await ui.press({ key: 'git-commit' })
  const commit = ran.find(a => a.includes('commit'))
  expect(commit).toBeDefined()
  const paths = commit!.slice(commit!.indexOf('--') + 1)
  expect(paths.sort()).toEqual(['a.txt', 'gone.txt', 'new.txt', 'newdir/', 'old.txt', 'with space.txt'])
  expect(commit).toContain('feat: tidy files')
  // A rename's old path is committed but never given to git add, which would refuse it
  expect(ran.find(a => a.includes('add'))).not.toContain('old.txt')
  // No branch switch: the branch is the checkout's
  expect(ran.some(a => a.includes('switch'))).toBe(false)
  expect(toasts.join(' ')).toContain('Committed abc1234')
  await ui.unmount()
})

test('a failed push says why', async ($, on) => {
  const toasts: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 }))
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
  await (ui as never as { input: (t: object) => Promise<unknown> }).input({ key: 'git-subject', text: 'x' } as never)
  await ui.press({ key: 'git-more' })
  await ui.press({ key: 'opt-push' })
  await ui.press({ key: 'git-commit' })
  expect(toasts.join(' ')).toContain("push failed: fatal: 'origin' does not appear to be a git repository")
  await ui.unmount()
})
