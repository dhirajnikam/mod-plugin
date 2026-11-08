import { expect, test } from 'claude-code/testing'
import { changeHook, changeMcp, changePerm, changeRule, hookRows, mcpRows, parseSettings, permRows, ruleLines, setInvocation, skillOf } from '../hooks/rules'

test('hooks, permission rules and instructions change in their files, the rest of each file kept', async () => {
  const j = { model: 'sonnet', hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }] }, permissions: { allow: ['Bash(npm test:*)'] } }
  // A hook joins the group of its matcher; a new matcher gets its own group
  let n = changeHook(j, { add: { event: 'PostToolUse', matcher: 'Edit', command: 'eslint --fix' } })
  n = changeHook(n, { add: { event: 'Stop', matcher: '', command: 'say done' } })
  expect(hookRows(n).map(h => `${h.event}|${h.matcher}|${h.command}`)).toEqual(['PostToolUse|Edit|prettier --write', 'PostToolUse|Edit|eslint --fix', 'Stop||say done'])
  expect(n.model).toBe('sonnet')
  // Edited, and a removed hook takes its empty group and event with it
  const [first, , stop] = hookRows(n)
  n = changeHook(n, { edit: first!, matcher: 'Write', command: 'prettier -w' })
  n = changeHook(n, { remove: stop! })
  expect(hookRows(n).map(h => `${h.event}|${h.matcher}|${h.command}`)).toEqual(['PostToolUse|Edit|eslint --fix', 'PostToolUse|Write|prettier -w'])
  expect('Stop' in (n.hooks as object)).toBe(false)
  // A row that no longer matches the file (it moved since it was shown) is left alone
  expect(changeHook(n, { remove: first! })).toEqual(n)
  // Permissions: added once, moved between lists, removed, and empty lists dropped
  let p = changePerm(j, { add: { kind: 'deny', rule: 'Bash(rm -rf:*)' } })
  p = changePerm(p, { add: { kind: 'deny', rule: 'Bash(rm -rf:*)' } })
  expect(permRows(p).map(r => `${r.kind}:${r.rule}`)).toEqual(['allow:Bash(npm test:*)', 'deny:Bash(rm -rf:*)'])
  p = changePerm(p, { edit: permRows(p)[0]!, kind: 'ask', rule: 'Bash(npm test:*)' })
  expect(permRows(p).map(r => `${r.kind}:${r.rule}`)).toEqual(['ask:Bash(npm test:*)', 'deny:Bash(rm -rf:*)'])
  expect('allow' in (p.permissions as object)).toBe(false)
  // Instructions: bullet lines only; prose and headings stay as they are
  const md = '# Rules\n\nWe use pnpm.\n- Run the tests first\n* Keep diffs small\n'
  expect(ruleLines(md).map(r => r.text)).toEqual(['Run the tests first', 'Keep diffs small'])
  let m = changeRule(md, { add: 'Never push to main' })
  m = changeRule(m, { edit: ruleLines(m)[1]!, text: 'Keep diffs very small' })
  m = changeRule(m, { remove: ruleLines(m)[0]! })
  expect(m).toBe('# Rules\n\nWe use pnpm.\n* Keep diffs very small\n- Never push to main\n')
  // A settings file that is not JSON is reported, never parsed as empty
  expect(parseSettings('{ "hooks": ').error).toContain('not valid JSON')
  expect(parseSettings('').error).toBe('')
})

// A session against an in-memory disk: the repository's and the user's files
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const pane = { plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } }

// A whole session end to end: about a second when the machine is quiet, past the 5 s default when it is busy
test('the Rules tab adds, edits and deletes hooks, rules and instructions, and never writes a broken settings file', { timeoutMs: 20_000 }, async ($, on) => {
  const disk: Record<string, string> = {
    '/repo/.claude/settings.json': JSON.stringify({ env: { A: '1' }, permissions: { allow: ['Bash(npm test:*)'] } }, null, 2),
    '/repo/CLAUDE.md': '# Repo\n- Run the tests first\n',
    '/home/me/.claude/settings.json': '{ "hooks": ',
  }
  const toasts: string[] = []
  const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('ui.toast', async (_: unknown, e: any) => (toasts.push(String(e.text)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('env.get', async (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.exists', async (_: unknown, e: any) => ({ value: posix(e.path) in disk }))
  on('fs.read', async (_: unknown, e: any) => {
    if (!(posix(e.path) in disk)) throw new Error('ENOENT')
    return { value: disk[posix(e.path)] } as never
  })
  on('fs.write', async (_: unknown, e: any) => ((disk[posix(e.path)] = e.text), { value: undefined }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd === 'git rev-parse --show-toplevel') return ok('/repo\n')
    return ok('')
  })
  on('command.run', async () => ({ text: '' }))
  // What Cockpit passes on to the engine draws as the engine's
  on('ui.render', async (_: any, e: any) => {
    const { Text } = _.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  await $.command.run({ command: 'cockpit', args: 'tab rules' } as never)
  const ui = await $.ui.mount(pane as never)
  let d = JSON.stringify(await ui.drawn())
  expect(d).toContain('Bash(npm test:*)')
  expect(d).toContain('Run the tests first')
  // Add a hook
  await ui.press({ key: 'radd-hook' })
  await (ui as any).input({ key: 'rf-ruleB', text: 'Edit', kind: 'change' } as never)
  await (ui as any).input({ key: 'rf-ruleC', text: 'npx prettier --write .' } as never)
  let saved = JSON.parse(disk['/repo/.claude/settings.json']!)
  expect(saved.hooks.PreToolUse[0]).toEqual({ matcher: 'Edit', hooks: [{ type: 'command', command: 'npx prettier --write .' }] })
  expect(saved.env).toEqual({ A: '1' })
  // Edit a permission rule into a deny
  d = JSON.stringify(await ui.drawn())
  await ui.press({ key: 're-p:allow/0' })
  await ui.press({ key: 'rp-ekind-deny' })
  await ui.press({ key: 'rp-save' })
  saved = JSON.parse(disk['/repo/.claude/settings.json']!)
  expect(saved.permissions).toEqual({ deny: ['Bash(npm test:*)'] })
  // Delete an instruction, after confirming
  await ui.press({ key: 'rd-r:l1' })
  expect(disk['/repo/CLAUDE.md']).toContain('Run the tests first')
  await ui.press({ key: 'rdy-r:l1' })
  expect(disk['/repo/CLAUDE.md']).toBe('# Repo\n')
  // The user's settings are broken JSON: shown read-only, and an instruction still goes to their CLAUDE.md
  await ui.press({ key: 'rscope-user' })
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('not valid JSON')
  expect(d).not.toContain('re-p:')
  await ui.press({ key: 'radd-rule' })
  await (ui as any).input({ key: 'rf-ruleB', text: 'Answer in British English' } as never)
  expect(disk['/home/me/.claude/CLAUDE.md']).toBe('- Answer in British English\n')
  expect(disk['/home/me/.claude/settings.json']).toBe('{ "hooks": ')
  await ui.unmount()
})

test('MCP servers: every scope and state read, secrets never kept, and .mcp.json changed with the rest kept', async () => {
  const mcp = { other: 1, mcpServers: { github: { command: 'npx', args: ['-y', '@mcp/github'], env: { GITHUB_TOKEN: 'ghp_SECRET1' } }, docs: { type: 'http', url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer SECRET2' } }, off: { command: 'off-srv' }, live: { type: 'sse', url: 'https://live.example/sse' } } }
  const claude = { mcpServers: { mine: { command: 'my-srv', env: { KEY: 'SECRET3' } } }, projects: { '/repo': { mcpServers: { local1: { command: 'loc' } }, disabledMcpServers: ['mine'], enabledMcpjsonServers: ['github', 'docs'] }, '/elsewhere': { mcpServers: { notmine: { command: 'x' } } } } }
  const settings = [{ disabledMcpjsonServers: ['off'] }, {}]
  const rows = mcpRows(mcp, claude, settings, '/repo')
  expect(rows.map(r => `${r.scope}|${r.name}|${r.kind}|${r.target}|${r.state}|${r.secrets.join(',')}`)).toEqual([
    'project|github|stdio|npx -y @mcp/github|on|GITHUB_TOKEN',
    'project|docs|http|https://docs.example/mcp|on|Authorization',
    'project|off|stdio|off-srv|off|',
    // Neither enabled nor disabled: Claude Code asks before it runs
    'project|live|sse|https://live.example/sse|approval|',
    'local|local1|stdio|loc|on|',
    // Switched off with /mcp in this project
    'user|mine|stdio|my-srv|off|KEY',
  ])
  expect(JSON.stringify(rows)).not.toContain('SECRET')
  // enableAllProjectMcpServers turns every unlisted project server on, but not one disabled by name
  expect(mcpRows(mcp, {}, [{ enableAllProjectMcpServers: true, disabledMcpjsonServers: ['off'] }], '/repo').map(r => r.state)).toEqual(['on', 'on', 'off', 'on'])
  // Control characters in a name or command draw as spaces
  expect(mcpRows({ mcpServers: { 'a\u001b[2Jb': { command: 'x\ny' } } }, {}, [], '/r')[0]).toMatchObject({ name: 'a [2Jb', target: 'x y' })
  // Added, edited (env kept), renamed, removed; the rest of the file kept
  let n = changeMcp(mcp, { add: { name: 'pg', target: 'npx -y @mcp/postgres postgres://localhost/db' } })
  n = changeMcp(n, { add: { name: 'web', target: 'https://web.example/mcp' } })
  expect((n.mcpServers as any).pg).toEqual({ command: 'npx', args: ['-y', '@mcp/postgres', 'postgres://localhost/db'] })
  expect((n.mcpServers as any).web).toEqual({ type: 'http', url: 'https://web.example/mcp' })
  // A taken name is not overwritten
  expect(changeMcp(n, { add: { name: 'github', target: 'evil' } })).toEqual(n)
  const gh = mcpRows(n, {}, [], '/repo').find(r => r.name === 'github')!
  n = changeMcp(n, { edit: gh, name: 'gh', target: 'npx -y @mcp/github@2' })
  expect((n.mcpServers as any).gh).toEqual({ command: 'npx', args: ['-y', '@mcp/github@2'], env: { GITHUB_TOKEN: 'ghp_SECRET1' } })
  expect('github' in (n.mcpServers as object)).toBe(false)
  // The old row no longer matches the file: left alone
  expect(changeMcp(n, { remove: gh })).toEqual(n)
  // Only project servers change here
  expect(changeMcp(n, { remove: { ...mcpRows(n, {}, [], '/repo')[0]!, scope: 'user' } })).toEqual(n)
  for (const r of mcpRows(n, {}, [], '/repo')) n = changeMcp(n, { remove: r })
  expect(n).toEqual({ other: 1 })
})

test('the Rules tab lists the MCP servers of every scope, changes only .mcp.json, and never shows a secret or writes ~/.claude.json', { timeoutMs: 20_000 }, async ($, on) => {
  const claudeJson = JSON.stringify({ numStartups: 9, mcpServers: { mine: { command: 'my-srv', env: { KEY: 'SECRET_USER' } } }, projects: { '/repo': { mcpServers: { scratch: { command: 'scratch-srv' } }, enabledMcpjsonServers: ['github'] } } })
  const disk: Record<string, string> = {
    '/repo/.mcp.json': JSON.stringify({ note: 'kept', mcpServers: { github: { command: 'npx', args: ['-y', '@mcp/github'], env: { GITHUB_TOKEN: 'ghp_SECRET' } }, docs: { type: 'http', url: 'https://docs.example/mcp' }, tok: { command: 'srv', args: ['--token', 'SECRET_ARG'] } } }, null, 2),
    // An approval given at Claude Code's prompt
    '/repo/.claude/settings.local.json': JSON.stringify({ enabledMcpjsonServers: ['tok'] }),
    '/home/me/.claude.json': claudeJson,
  }
  const writes: string[] = []
  const toasts: string[] = []
  const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('ui.toast', async (_: unknown, e: any) => (toasts.push(String(e.text)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('env.get', async (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.exists', async (_: unknown, e: any) => ({ value: posix(e.path) in disk }))
  on('fs.read', async (_: unknown, e: any) => {
    if (!(posix(e.path) in disk)) throw new Error('ENOENT')
    return { value: disk[posix(e.path)] } as never
  })
  on('fs.write', async (_: unknown, e: any) => (writes.push(posix(e.path)), (disk[posix(e.path)] = e.text), { value: undefined }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    return cmd === 'git rev-parse --show-toplevel' ? ok('/repo\n') : ok('')
  })
  on('command.run', async () => ({ text: '' }))
  await $.command.run({ command: 'cockpit', args: 'tab rules' } as never)
  const ui = await $.ui.mount(pane as never)
  let d = JSON.stringify(await ui.drawn())
  // This repository: the project's servers with their state, and this project's local one, read only
  expect(d).toContain('npx -y @mcp/github')
  expect(d).toContain('needs approval')
  expect(d).toContain('secrets: GITHUB_TOKEN')
  expect(d).toContain('scratch-srv')
  expect(d).toContain('local, only you')
  expect(d).toContain('re-m:project/github')
  expect(d).not.toContain('re-m:local/scratch')
  expect(d).not.toContain('SECRET')
  // The token in tok's arguments is masked, and the approval in settings.local.json counts
  expect(d).toContain('srv --token •••')
  expect(d.split('needs approval').length - 1).toBe(1)
  // Its edit form never holds the token
  await ui.press({ key: 're-m:project/tok' })
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('not shown here')
  expect(d).not.toContain('SECRET')
  await ui.press({ key: 'rm-cancel' })
  // Add a server: written to .mcp.json, the rest kept
  await ui.press({ key: 'radd-mcp' })
  await (ui as any).input({ key: 'rf-ruleA', text: 'pg', kind: 'change' } as never)
  await (ui as any).input({ key: 'rf-ruleB', text: 'npx -y @mcp/postgres' } as never)
  let saved = JSON.parse(disk['/repo/.mcp.json']!)
  expect(saved.mcpServers.pg).toEqual({ command: 'npx', args: ['-y', '@mcp/postgres'] })
  expect(saved.note).toBe('kept')
  // Edit what github runs: its token stays in the file, unseen
  await ui.press({ key: 're-m:project/github' })
  await (ui as any).input({ key: 'rf-ruleB', text: 'npx -y @mcp/github@2' } as never)
  saved = JSON.parse(disk['/repo/.mcp.json']!)
  expect(saved.mcpServers.github).toEqual({ command: 'npx', args: ['-y', '@mcp/github@2'], env: { GITHUB_TOKEN: 'ghp_SECRET' } })
  expect(JSON.stringify(await ui.drawn())).not.toContain('SECRET')
  // Delete one, after confirming
  await ui.press({ key: 'rd-m:project/docs' })
  expect(JSON.parse(disk['/repo/.mcp.json']!).mcpServers.docs).toBeDefined()
  await ui.press({ key: 'rdy-m:project/docs' })
  expect(JSON.parse(disk['/repo/.mcp.json']!).mcpServers.docs).toBeUndefined()
  // You, everywhere: your servers, read only, no Add
  await ui.press({ key: 'rscope-user' })
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('my-srv')
  expect(d).toContain('secrets: KEY')
  expect(d).not.toContain('radd-mcp')
  expect(d).not.toContain('re-m:user/mine')
  expect(d).not.toContain('SECRET')
  // .mcp.json broken by hand after it was shown: a delete is refused with a toast and the file is left as it was
  await ui.press({ key: 'rscope-repo' })
  disk['/repo/.mcp.json'] = '{ "mcpServers": '
  await ui.press({ key: 'rd-m:project/pg' })
  await ui.press({ key: 'rdy-m:project/pg' })
  expect(disk['/repo/.mcp.json']).toBe('{ "mcpServers": ')
  expect(toasts.join('\n')).toContain('Cockpit will not overwrite it')
  // Read again, it shows read only
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('Its servers are shown read-only')
  expect(d).not.toContain('radd-mcp')
  // Only .mcp.json was ever written; ~/.claude.json is exactly as it was
  expect([...new Set(writes)]).toEqual(['/repo/.mcp.json'])
  expect(disk['/home/me/.claude.json']).toBe(claudeJson)
  await ui.unmount()
})

test("MCP servers: tokens in a target are masked, nearer servers win, Windows project keys match, and edits never reshape a server", async () => {
  // Tokens a URL or the arguments carry are masked; what is not a token is kept
  const t = (target: string) => mcpRows({ mcpServers: { s: target.startsWith('http') ? { url: target } : { command: target.split(' ')[0], args: target.split(' ').slice(1) } } }, {}, [], '/r')[0]!
  expect(t('https://u:pw@h.example/mcp?token=SEKRIT&x=1').target).toBe('https://•••@h.example/mcp?token=•••&x=•••')
  expect(t('srv --token SEKRIT --port 8080').target).toBe('srv --token ••• --port 8080')
  expect(t('srv --api-key=SEKRIT API_KEY=SEKRIT').target).toBe('srv --api-key=••• API_KEY=•••')
  expect(t('srv ghp_abcdefghijklmnop sk-abcdefghijkl').target).toBe('srv ••• •••')
  expect(t('npx -y @mcp/github').masked).toBe(false)
  expect(t('srv --token SEKRIT').masked).toBe(true)
  // One name, one server: local over project over user
  const rows = mcpRows({ mcpServers: { db: { command: 'proj' } } }, { mcpServers: { db: { command: 'user' } }, projects: { 'C:/Users/me/repo': { mcpServers: { db: { command: 'local' } } } } }, [{ enableAllProjectMcpServers: true }], 'C:\\Users\\me\\repo\\')
  expect(rows.map(r => `${r.scope}:${r.target}:${r.state}`)).toEqual(['project:proj:shadowed', 'local:local:on', 'user:user:shadowed'])
  // A rename keeps what it runs exactly (quoted arguments, an sse type) and its place among the servers
  const j = { mcpServers: { a: { command: 'sh', args: ['-c', 'echo hi'] }, live: { type: 'sse', url: 'https://l.example/sse', headers: { Authorization: 'Bearer x' } }, z: { command: 'z' } } }
  const [a, live] = mcpRows(j, {}, [], '/r')
  let n = changeMcp(j, { edit: a!, name: 'a2', target: a!.target })
  expect(n.mcpServers).toEqual({ a2: { command: 'sh', args: ['-c', 'echo hi'] }, live: j.mcpServers.live, z: { command: 'z' } })
  expect(Object.keys(n.mcpServers as object)).toEqual(['a2', 'live', 'z'])
  n = changeMcp(j, { edit: live!, name: 'stream', target: '' })
  expect((n.mcpServers as any).stream).toEqual(j.mcpServers.live)
  // A masked target is never written back: only an empty or untouched one keeps it
  const sec = { mcpServers: { s: { command: 'srv', args: ['--token', 'SEKRIT'] } } }
  const row = mcpRows(sec, {}, [], '/r')[0]!
  expect(changeMcp(sec, { edit: row, name: 's', target: 'srv --token •••' })).toEqual(sec)
  expect(changeMcp(sec, { edit: row, name: 's', target: 'srv --token OTHER' })).toEqual(sec)
  expect((changeMcp(sec, { edit: row, name: 's2', target: '' }).mcpServers as any).s2).toEqual(sec.mcpServers.s)
  // Names: own keys only, Claude Code's characters only, the special object keys refused
  expect((changeMcp({}, { add: { name: 'toString', target: 'x' } }).mcpServers as any).toString).toEqual({ command: 'x', args: [] })
  for (const bad of ['__proto__', 'constructor', 'has space', 'dot.ted', '']) expect(changeMcp({}, { add: { name: bad, target: 'x' } })).toEqual({})
  // An entry that is not an object, or an mcpServers that is not one, is left for you to fix by hand
  const junk = { mcpServers: { a: 'junk' } }
  expect(changeMcp(junk, { edit: mcpRows(junk, {}, [], '/r')[0]!, name: 'b', target: 'x' })).toEqual(junk)
  expect(changeMcp(junk, { remove: mcpRows(junk, {}, [], '/r')[0]! })).toEqual(junk)
  expect(changeMcp({ mcpServers: ['keep'] }, { add: { name: 'x', target: 'x' } })).toEqual({ mcpServers: ['keep'] })
  // A name with a control character in it draws cleaned, and can still be renamed and deleted
  const odd = { mcpServers: { 'a\u0007b': { command: 'x' } } }
  const oddRow = mcpRows(odd, {}, [], '/r')[0]!
  expect(oddRow.name).toBe('a b')
  expect(changeMcp(odd, { edit: oddRow, name: 'ab', target: '' })).toEqual({ mcpServers: { ab: { command: 'x' } } })
  expect(changeMcp(odd, { remove: oddRow })).toEqual({})
})

test('skills: name, description and invocation read from the frontmatter, and the switch changes only its own line', async () => {
  const md = '---\nname: release\ndescription: Cut a release and write its notes\n---\n\n# Release\n\nSteps, with --- in the body\n'
  expect(skillOf(md)).toEqual({ name: 'release', description: 'Cut a release and write its notes', auto: true, error: '' })
  // Quoted, folded and literal descriptions; the key set to true
  expect(skillOf('---\nname: "q"\ndescription: "Say \\"hi\\" twice"\n---\n').description).toBe('Say "hi" twice')
  expect(skillOf("---\ndescription: 'it''s fine'\n---\n").description).toBe("it's fine")
  expect(skillOf('---\nname: f\ndescription: >\n  Folded over\n  two lines\ndisable-model-invocation: true\n---\nbody').description).toBe('Folded over two lines')
  expect(skillOf('---\ndescription: |-\n  Literal\n  block\n---\n').description).toBe('Literal block')
  expect(skillOf('---\nname: f\ndisable-model-invocation: true\n---\n').auto).toBe(false)
  // Control characters in what it says draw as spaces
  expect(skillOf('---\ndescription: a\u001b[2Jb\n---\n').description).toBe('a [2Jb')
  // Off and back on: the file is exactly as it was, the body untouched, CRLF kept
  const off = setInvocation(md, false)!
  expect(off).toBe('---\nname: release\ndescription: Cut a release and write its notes\ndisable-model-invocation: true\n---\n\n# Release\n\nSteps, with --- in the body\n')
  expect(skillOf(off).auto).toBe(false)
  expect(setInvocation(off, true)).toBe(md)
  const crlf = md.replace(/\n/g, '\r\n')
  expect(setInvocation(crlf, false)).toBe(off.replace(/\n/g, '\r\n'))
  expect(setInvocation(setInvocation(crlf, false)!, true)).toBe(crlf)
  // A key already there is set, not repeated; switching on what is on changes nothing
  expect(setInvocation('---\ndisable-model-invocation: false\n---\nb', false)).toBe('---\ndisable-model-invocation: true\n---\nb')
  expect(setInvocation(md, true)).toBe(md)
  // No frontmatter, or one never closed: unreadable, never changed
  expect(skillOf('# Just markdown').error).toContain('no frontmatter')
  expect(skillOf('---\nname: x\n').error).toContain('not closed')
  expect(setInvocation('# Just markdown', false)).toBe(null)
  expect(setInvocation('---\nname: x\n', false)).toBe(null)
})

test("the Rules tab lists each scope's skills and switches one between Claude loading it and /name only, writing only that SKILL.md", { timeoutMs: 20_000 }, async ($, on) => {
  const release = '---\nname: release\ndescription: Cut a release and write its notes\n---\n\n# Release\n'
  const notes = '---\r\nname: notes\r\ndescription: Keep meeting notes\r\ndisable-model-invocation: true\r\n---\r\nbody\r\n'
  const disk: Record<string, string> = {
    '/repo/.claude/skills/release/SKILL.md': release,
    '/repo/.claude/skills/broken/SKILL.md': '# no frontmatter here',
    '/repo/.claude/skills/empty/README.md': 'a folder with no SKILL.md',
    '/home/me/.claude/skills/notes/SKILL.md': notes,
  }
  const writes: string[] = []
  const toasts: string[] = []
  const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('ui.toast', async (_: unknown, e: any) => (toasts.push(String(e.text)), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('env.get', async (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.exists', async (_: unknown, e: any) => ({ value: posix(e.path) in disk }))
  // A folder's entries, from the paths on the disk
  on('fs.list', async (_: unknown, e: any) => {
    const dir = `${posix(e.path)}/`
    const kids = new Map<string, string>()
    for (const p of Object.keys(disk)) if (p.startsWith(dir)) { const [first, ...rest] = p.slice(dir.length).split('/'); kids.set(first!, rest.length ? 'dir' : 'file') }
    return { value: [...kids].map(([name, kind]) => ({ name, kind })) } as never
  })
  on('fs.read', async (_: unknown, e: any) => {
    if (!(posix(e.path) in disk)) throw new Error('ENOENT')
    return { value: disk[posix(e.path)] } as never
  })
  on('fs.write', async (_: unknown, e: any) => (writes.push(posix(e.path)), (disk[posix(e.path)] = e.text), { value: undefined }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    return cmd === 'git rev-parse --show-toplevel' ? ok('/repo\n') : ok('')
  })
  on('command.run', async () => ({ text: '' }))
  await $.command.run({ command: 'cockpit', args: 'tab rules' } as never)
  const ui = await $.ui.mount(pane as never)
  let d = JSON.stringify(await ui.drawn())
  // This repository: release, Claude loads it; broken, read only with why; the folder with no SKILL.md left out
  expect(d).toContain('Cut a release and write its notes')
  expect(d).toContain('Claude loads it')
  expect(d).toContain('it has no frontmatter')
  expect(d).not.toContain('sk-/repo/.claude/skills/broken/SKILL.md')
  expect(d).not.toContain('"empty"')
  // Call only, then back: the file ends exactly as it began
  await ui.press({ key: 'sk-/repo/.claude/skills/release/SKILL.md' })
  expect(disk['/repo/.claude/skills/release/SKILL.md']).toContain('disable-model-invocation: true')
  expect(JSON.stringify(await ui.drawn())).toContain('only when you call /release')
  await ui.press({ key: 'sk-/repo/.claude/skills/release/SKILL.md' })
  expect(disk['/repo/.claude/skills/release/SKILL.md']).toBe(release)
  // You, everywhere: notes, kept for /notes; let Claude load it, the CRLF file kept as CRLF
  await ui.press({ key: 'rscope-user' })
  d = JSON.stringify(await ui.drawn())
  expect(d).toContain('only when you call /notes')
  await ui.press({ key: 'sk-/home/me/.claude/skills/notes/SKILL.md' })
  expect(disk['/home/me/.claude/skills/notes/SKILL.md']).toBe('---\r\nname: notes\r\ndescription: Keep meeting notes\r\n---\r\nbody\r\n')
  // A SKILL.md broken by hand after it was shown is refused, read again, and left as it was
  disk['/home/me/.claude/skills/notes/SKILL.md'] = '---\nname: notes\n'
  await ui.press({ key: 'sk-/home/me/.claude/skills/notes/SKILL.md' })
  expect(disk['/home/me/.claude/skills/notes/SKILL.md']).toBe('---\nname: notes\n')
  expect(toasts.join('\n')).toContain('Cockpit will not change it')
  expect(JSON.stringify(await ui.drawn())).toContain('not closed')
  // Only those two SKILL.md files were ever written
  expect([...new Set(writes)].sort()).toEqual(['/home/me/.claude/skills/notes/SKILL.md', '/repo/.claude/skills/release/SKILL.md'])
  await ui.unmount()
})
