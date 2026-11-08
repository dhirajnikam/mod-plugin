import { expect, test } from 'claude-code/testing'

// git's own output for a repo with an edit, a deletion, a file staged earlier, a rename, a new folder and a name with a space
const STATUS = '## master...origin/master [ahead 2]\0 M a.txt\0 D gone.txt\0M  keep.txt\0R  new.txt\0old.txt\0?? newdir/\0?? with space.txt\0'
const NUMSTAT = '1\t0\ta.txt\x000\t1\tgone.txt\x001\t0\tkeep.txt\x000\t0\t\0old.txt\0new.txt\0'

const scroll = { offset: 0, bodyRows: 40 }
const PANE = { plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll, view: {} } }

// A whole session end to end: about a second when the machine is quiet, past the 5 s default when it is busy
test('the Git tab reads the repo and commits only the ticked files', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('prompt.submit', async (_, e) => ({ text: e.text }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async (_, e) => (toasts.push(String((e as { text?: unknown }).text ?? JSON.stringify(e))), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  // The commit is written from the diff: the model sees the changed files, never the prompt
  const asked: string[] = []
  on('model.complete', async (_: unknown, e: any) => {
    asked.push(String(e.prompt))
    return String(e.prompt).startsWith('Write the commit') ? ({ value: { isAnswered: true, text: '{"type": "refactor", "subject": "Tidy the files."}', usage: { inputTokens: 1, outputTokens: 1 } } } as never) : ({ value: { isAnswered: false, reason: 'empty-reply' } } as never)
  })
  on('process.run', async (_, e) => {
    const argv = (e as unknown as { argv?: string[]; command?: string[] }).argv ?? (e as unknown as string[])
    const a = Array.isArray(argv) ? argv : Object.values(e as object).find(Array.isArray) as string[]
    ran.push(a)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal: nope' : '', isStdoutTruncated: false, isStderrTruncated: false } })
    const cmd = a.join(' ')
    if (cmd.startsWith('git status')) return out(STATUS)
    if (cmd.startsWith('git diff --numstat')) return out(NUMSTAT)
    if (cmd.startsWith('git diff HEAD -M')) return out('diff --git a/a.txt b/a.txt\n-old line\n+new line\n')
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
  // The prompt's words are not the message
  await $.prompt.submit({ text: 'please fix my thing', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  ran.length = 0
  await ui.press({ key: 'git-commit' })
  const commit = ran.find(a => a.includes('commit'))
  expect(commit).toBeDefined()
  const paths = commit!.slice(commit!.indexOf('--') + 1)
  expect(paths.sort()).toEqual(['a.txt', 'gone.txt', 'new.txt', 'newdir/', 'old.txt', 'with space.txt'])
  // Type and subject are written from the diff of the ticked files, the branch cut off master by the pattern
  expect(commit).toContain('refactor: tidy the files')
  expect(commit!.join(' ')).not.toContain('please fix my thing')
  // The commit's message was written from the diff of the ticked files alone (keep.txt was unticked)
  const briefs = asked.filter(x => x.startsWith('Write the commit'))
  expect(briefs.some(x => x.includes('+new line') && !x.includes('keep.txt'))).toBe(true)
  expect(briefs.join(' ')).not.toContain('please fix my thing')
  // A rename's old path is committed but never given to git add, which would refuse it
  expect(ran.find(a => a.includes('add'))).not.toContain('old.txt')
  expect(ran.some(a => a.join(' ').startsWith('git switch') && a.includes('refactor/tidy-the-files'))).toBe(true)
  expect(toasts.join(' ')).toContain('Committed abc1234')
  await ui.unmount()
})

// End to end: under a second when the machine is quiet, but it can pass the 5 s default when the machine is busy
test('a failed push says why', { timeoutMs: 20_000 }, async ($, on) => {
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

// End to end: under a second when the machine is quiet, but it can pass the 5 s default when the machine is busy
test('accounts come from and go to the machine: a token logs in with gh, push goes out as the account, Remove logs out', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: { argv: string[]; stdin?: string }[] = []
  const toasts: string[] = []
  const store: Record<string, unknown> = {}
  // gh's logins as `gh auth status` reports them; the global git identity is bob's
  let logins = ['alice', 'bob']
  let active = 'alice'
  let identity = true
  let switchFails = false
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('prompt.submit', async (_, e) => ({ text: e.text }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', async (_: unknown, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('ui.toast', async (_, e) => (toasts.push(JSON.stringify(e)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_, e) => {
    const { argv, init } = e as unknown as { argv: string[]; init?: { stdin?: string } }
    ran.push({ argv, stdin: init?.stdin })
    const cmd = argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out('## main...origin/main [ahead 1]\0')
    if (cmd === 'git config --global user.name') return out(identity ? 'bob\n' : '', identity ? 0 : 1)
    if (cmd === 'git config --global user.email') return out(identity ? 'bob@x.io\n' : '', identity ? 0 : 1)
    if (cmd.startsWith('git config --global --unset')) return (identity = false), out('')
    if (cmd.startsWith('gh auth status')) return out(`github.com\n${logins.map(l => `  ✓ Logged in to github.com account ${l} (keyring)\n  - Active account: ${l === active}\n`).join('\n')}`)
    if (cmd.startsWith('gh auth login --with-token')) return (logins = [...logins, 'carol']), (active = 'carol'), out('')
    if (cmd.startsWith('gh auth logout')) return (logins = logins.filter(l => l !== argv[argv.length - 1])), out('')
    if (cmd.startsWith('gh auth switch')) return switchFails ? out('', 1) : ((active = argv[argv.length - 1]!), out(''))
    if (cmd === 'gh api user --jq .login') return out(`${active}\n`)
    if (cmd.startsWith('gh api users/')) return out(`${argv[2]!.length}00\t${argv[2]!.slice(6).toUpperCase()}\n`)
    return out('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const ui = await $.ui.mount(PANE as never)
  for (let i = 0; i < 4; i++) await ui.press({ key: 'setup-next' })
  await ui.press({ key: 'setup-done' })
  await ui.press({ key: 'git-more' })
  await ui.press({ key: 'acct-detect' }).catch(() => null)
  let drawn = JSON.stringify(await ui.drawn())
  // The global identity pushes as the login of its own name; alice is listed with her GitHub no-reply address
  expect(drawn).toContain('bob <bob@x.io> · gh bob')
  await ui.press({ key: 'acct-modify' })
  expect(JSON.stringify(await ui.drawn())).toContain('alice')

  // A token is handed to gh on stdin, git is set to ask gh for credentials, and the new login is chosen
  await (ui as any).input({ key: 'gh-token', text: 'ghp_secret' })
  const login = ran.find(r => r.argv.join(' ').startsWith('gh auth login --with-token'))
  expect(login?.stdin).toBe('ghp_secret\n')
  expect(login?.argv.join(' ')).not.toContain('ghp_secret')
  expect(ran.some(r => r.argv.join(' ') === 'gh auth setup-git -h github.com')).toBe(true)
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('· gh carol')
  expect(drawn).toContain('100+carol@users.noreply.github.com')
  expect(drawn).not.toContain('ghp_secret')

  // Push as alice: gh switches to her and git asks gh, both before the push
  await ui.press({ key: 'acct-modify' })
  await ui.press({ key: 'acct-gh-alice' })
  ran.length = 0
  await ui.press({ key: 'git-push' })
  const order = ran.map(r => r.argv.join(' '))
  const sw = order.indexOf('gh auth switch -h github.com --user alice')
  expect(sw).toBeGreaterThan(-1)
  expect(order.indexOf('gh auth setup-git -h github.com')).toBeGreaterThan(sw)
  expect(order.findIndex(c => c.startsWith('git push'))).toBeGreaterThan(sw)
  // A switch gh refuses still leaves git asking gh, and says why
  switchFails = true
  ran.length = 0
  await ui.press({ key: 'git-push' })
  expect(ran.some(r => r.argv.join(' ') === 'gh auth setup-git -h github.com')).toBe(true)
  expect(toasts.join(' ')).toContain('gh switch to alice failed')
  switchFails = false

  // Remove asks first, then logs the login out of gh; Detect does not bring it back
  await ui.press({ key: 'acct-remove' })
  expect(JSON.stringify(await ui.drawn())).toContain('from this machine?')
  ran.length = 0
  await ui.press({ key: 'acct-remove-yes' })
  expect(ran.some(r => r.argv.join(' ') === 'gh auth logout -h github.com -u alice')).toBe(true)
  expect(logins).not.toContain('alice')
  await ui.press({ key: 'acct-detect' }).catch(() => null)
  expect(JSON.stringify(await ui.drawn())).not.toContain('acct-gh-alice')
  expect(toasts.join(' ')).toContain('Removed alice from this machine')
  await ui.unmount()
})

test('a gh login added outside Cockpit, or a token that stopped working, shows when the Git tab is opened again', { timeoutMs: 20_000 }, async ($, on) => {
  // What `gh auth status` says: at first only alice; then dave, added with gh in a terminal; then alice's token fails
  let status = '  ✓ Logged in to github.com account alice (keyring)\n  - Active account: true\n'
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_, e) => {
    const { argv } = e as unknown as { argv: string[] }
    const cmd = argv.join(' ')
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out('## main\0')
    if (cmd.startsWith('gh auth status')) return out(`github.com\n${status}`)
    return out('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const ui = await $.ui.mount(PANE as never)
  expect(JSON.stringify(await ui.drawn())).toContain('alice')
  expect(JSON.stringify(await ui.drawn())).not.toContain('dave')
  // A login added in a terminal: opening the tab again finds it, no Detect pressed
  status += '\n  ✓ Logged in to github.com account dave (keyring)\n  - Active account: false\n'
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  await ui.press({ key: 'acct-modify' })
  expect(JSON.stringify(await ui.drawn())).toContain('acct-gh-dave')
  // alice's token fails: she is named in the box, and dave, still logged in, is not taken for the active login
  status = '  X Failed to log in to github.com account alice (keyring)\n  - Active account: true\n  - The token in keyring is invalid.\n\n  ✓ Logged in to github.com account dave (keyring)\n  - Active account: false\n'
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('The GitHub token for alice no longer works')
  expect(drawn).not.toContain('acct-gh-alice')
  // Fixed again: the note goes
  status = '  ✓ Logged in to github.com account alice (keyring)\n  - Active account: true\n'
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  expect(JSON.stringify(await ui.drawn())).not.toContain('no longer works')
  await ui.unmount()
})

test("the branch's pull request is read with gh when the Git tab opens, its checks only once gh finds one, and never on the base branch", { timeoutMs: 20_000 }, async ($, on) => {
  const ran: string[] = []
  let branch = 'feat/x'
  let view = { exitCode: 0, stdout: '{"number":7,"title":"Add x","url":"https://github.com/o/r/pull/7","state":"OPEN","isDraft":false,"reviewDecision":"REVIEW_REQUIRED"}' }
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const asked: string[] = []
  on('prompt.submit', async (_: unknown, e: any) => (asked.push(String(e.text)), { text: e.text }))
  on('process.run', async (_, e) => {
    const { argv } = e as unknown as { argv: string[] }
    const cmd = argv.join(' ')
    ran.push(cmd)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'no pull requests found' : '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out(`## ${branch}\0`)
    if (cmd.startsWith('git branch')) return out('main\nfeat/x\n')
    if (cmd.startsWith('gh pr view')) return out(view.stdout, view.exitCode)
    // gh exits 1 when a check failed, printing the JSON all the same
    if (cmd.startsWith('gh run view 42 --log-failed')) return out(Array.from({ length: 300 }, (_, n) => `test\tRun tests\tline ${n}`).join('\n') + '\ntest\tRun tests\tAssertionError: expected 2 to be 3')
    if (cmd.startsWith('gh pr checks')) return out('[{"name":"test","bucket":"fail","link":"https://github.com/o/r/actions/runs/42/job/1"},{"name":"lint","bucket":"pass"}]', 1)
    return out('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  expect(ran).toContain('gh pr view --json number,title,url,state,isDraft,reviewDecision -- feat/x')
  expect(ran).toContain('gh pr checks --json name,bucket,link -- feat/x')
  const ui = await $.ui.mount(PANE as never)
  for (const step of ['Account', 'Branch pattern', 'Message pattern', 'Commit mode', 'When']) await ui.press({ key: step === 'When' ? 'setup-done' : 'setup-next' })
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('#7')
  expect(drawn).toContain('Add x')
  expect(drawn).toContain('review required')
  expect(drawn).toContain('✓ 1 passed')
  expect(drawn).toContain('✗ 1 failed')
  expect(drawn).toContain('✗ test')
  // Fix failing checks: Claude is handed the check's name and the end of its failed log, not all of it
  await ui.press({ key: 'pr-fix' })
  expect(ran).toContain('gh run view 42 --log-failed')
  const fix = asked.find(a => a.startsWith('Fix the failing CI checks on pull request #7')) ?? ''
  expect(fix).toContain('test, the end of its failed steps')
  expect(fix).toContain('AssertionError: expected 2 to be 3')
  expect(fix).not.toContain('line 100\n')
  // No PR (or gh not logged in): no checks asked for
  view = { exitCode: 1, stdout: '' }
  ran.length = 0
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  expect(ran.some(c => c.startsWith('gh pr view'))).toBe(true)
  expect(ran.some(c => c.startsWith('gh pr checks'))).toBe(false)
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toContain('#7')
  // On the base branch gh is not asked at all
  branch = 'main'
  ran.length = 0
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  expect(ran.some(c => c.startsWith('gh pr'))).toBe(false)
  await ui.unmount()
})

test("the pull request row survives what GitHub and gh can hand it: escapes in a title, gh failing, a closed PR, and reads answering out of order", { timeoutMs: 20_000 }, async ($, on) => {
  let view: () => Promise<{ exitCode: number; stdout: string; stderr: string }> = async () => ({ exitCode: 0, stdout: JSON.stringify({ number: 9, title: 'evil\nSECOND\x1b[2J\x1b]0;pwn\x07end', state: 'OPEN' }), stderr: '' })
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_, e) => {
    const cmd = (e as unknown as { argv: string[] }).argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out('## feat/x\0')
    if (cmd.startsWith('git branch')) return out('main\nfeat/x\n')
    if (cmd.startsWith('gh pr view')) return { value: { ...(await view()), isStdoutTruncated: false, isStderrTruncated: false } }
    if (cmd.startsWith('gh pr checks')) return out('[{"name":"x\\u001b[1my","bucket":"fail"}]', 1)
    return out('')
  })
  const open = () => $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  await open()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  for (const step of ['Account', 'Branch pattern', 'Message pattern', 'Commit mode', 'When']) await ui.press({ key: step === 'When' ? 'setup-done' : 'setup-next' })
  // Escapes and newlines draw as spaces: the pane draws, on one line
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('#9')
  expect(drawn).toContain('evil SECOND')
  expect(drawn).toContain('✗ x [1my')
  // gh cannot answer (offline): the row stays; gh says there is no PR: it goes
  view = async () => ({ exitCode: 1, stdout: '', stderr: 'error connecting to api.github.com' })
  await open()
  expect(JSON.stringify(await ui.drawn())).toContain('#9')
  view = async () => ({ exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "feat/x"' })
  await open()
  expect(JSON.stringify(await ui.drawn())).not.toContain('#9')
  // A closed PR says so, and offers no fix
  view = async () => ({ exitCode: 0, stdout: JSON.stringify({ number: 9, title: 't', state: 'CLOSED', reviewDecision: 'CHANGES_REQUESTED' }), stderr: '' })
  await open()
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('closed')
  expect(drawn).not.toContain('changes requested')
  expect(drawn).not.toContain('pr-fix')
  // Two reads on one branch, the older answering last: the newer one's PR stands
  let answer!: () => void
  view = () => new Promise(r => { answer = () => r({ exitCode: 0, stdout: JSON.stringify({ number: 1, title: 'STALE', state: 'OPEN' }), stderr: '' }) })
  const slow = open()
  for (let i = 0; i < 10_000 && !answer; i++) await Promise.resolve()
  expect(typeof answer).toBe('function')
  view = async () => ({ exitCode: 0, stdout: JSON.stringify({ number: 2, title: 'FRESH', state: 'OPEN' }), stderr: '' })
  await open()
  answer?.()
  await slow
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('FRESH')
  expect(drawn).not.toContain('STALE')
  await ui.unmount()
})

test('with no origin and no main, master or develop, the branch you are on is not taken for the base, and its PR is read', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_, e) => {
    const cmd = (e as unknown as { argv: string[] }).argv.join(' ')
    ran.push(cmd)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out('## feat/x\0')
    if (cmd.startsWith('git branch')) return out('feat/x\n')
    if (cmd.startsWith('git symbolic-ref')) return out('', 1)
    if (cmd.startsWith('gh pr view')) return out('{"number":5,"title":"Lonely branch","state":"OPEN"}')
    if (cmd.startsWith('gh pr checks')) return out('[]')
    return out('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  // Opened again: a base kept from the first read would now skip the PR
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  expect(ran.filter(c => c.startsWith('gh pr view')).length).toBe(2)
  const ui = await $.ui.mount(PANE as never)
  for (const step of ['Account', 'Branch pattern', 'Message pattern', 'Commit mode', 'When']) await ui.press({ key: step === 'When' ? 'setup-done' : 'setup-next' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('#5')
  expect(drawn).toContain('no checks')
  await ui.unmount()
})

test('a base set to the branch you are on, with no real base around, is let go on the next read; with no base a commit skips the PR and says why', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: string[] = []
  const toasts: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async (_, e) => (toasts.push(String((e as { text?: unknown }).text ?? '')), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('process.run', async (_, e) => {
    const cmd = (e as unknown as { argv: string[] }).argv.join(' ')
    ran.push(cmd)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out('## feat/x\0 M a.txt\0')
    if (cmd.startsWith('git diff --numstat')) return out('1\t0\ta.txt\0')
    if (cmd.startsWith('git branch')) return out('feat/x\n')
    if (cmd.startsWith('git symbolic-ref')) return out('', 1)
    if (cmd.startsWith('git rev-parse')) return out('abc1234\n')
    if (cmd.startsWith('gh pr view')) return out('{"number":5,"title":"Lonely branch","state":"OPEN"}')
    if (cmd.startsWith('gh pr checks')) return out('[]')
    return out('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const ui = await $.ui.mount(PANE as never)
  for (const step of ['Account', 'Branch pattern', 'Message pattern', 'Commit mode', 'When']) await ui.press({ key: step === 'When' ? 'setup-done' : 'setup-next' })
  // The branch you are on, picked as the base, as the old fallback saved it
  await ui.press({ key: 'git-more' })
  await ui.select({ key: 'git-base', value: 'feat/x' })
  // The next read lets it go: the PR is read, not skipped as the base's
  ran.length = 0
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  expect(ran.filter(c => c.startsWith('gh pr view')).length).toBe(1)
  expect(JSON.stringify(await ui.drawn())).toContain('#5')
  // Push and pull requests on, no base: the commit is pushed, no PR is asked of gh, and the toast says why
  await ui.press({ key: 'opt-push' })
  await ui.press({ key: 'opt-pr' })
  expect(JSON.stringify(await ui.drawn())).toContain('PR → no base picked')
  ran.length = 0
  await ui.press({ key: 'git-commit' })
  expect(ran.some(c => c.startsWith('git push'))).toBe(true)
  expect(ran.some(c => c.startsWith('gh pr create'))).toBe(false)
  expect(toasts.join('\n')).toContain('no PR: pick a base in Patterns & options')
  await ui.unmount()
})
