import { expect, test } from 'claude-code/testing'
import { openMore, ok, posix } from './more'
import { changeHook, hookRows, changePerm, permRows, ruleLines, changeRule, parseSettings, mcpRows, changeMcp, skillOf, setInvocation, skillListed, importsOf, resolveMemory, memoryStarts, startupLoad } from '../hooks/rules/rules'
import type { MemoryRead } from '../hooks/rules/rules'

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
const pane = { plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } }

// A whole session end to end: about a second when the machine is quiet, past the 5 s default when it is busy
test('the Rules tab adds, edits and deletes hooks, rules and instructions, and never writes a broken settings file', { timeoutMs: 20_000 }, async ($, on) => {
  const disk: Record<string, string> = {
    '/repo/.claude/settings.json': JSON.stringify({ env: { A: '1' }, permissions: { allow: ['Bash(npm test:*)'] } }, null, 2),
    '/repo/CLAUDE.md': '# Repo\n- Run the tests first\n',
    '/home/me/.claude/settings.json': '{ "hooks": ',
  }
  const toasts: string[] = []
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
  let diskFull = false
  on('fs.write', async (_: unknown, e: any) => {
    if (diskFull) throw new Error('ENOSPC')
    disk[posix(e.path)] = e.text
    return { value: undefined }
  })
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd === 'git rev-parse --show-toplevel') return ok('/repo\n')
    return ok('')
  })
  on('command.run', async () => ({ text: '' }))
  await $.command.run({ command: 'cockpit', args: 'tab rules' } as never)
  const ui = await $.ui.mount(pane as never)
  await openMore(ui)
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
  // A write that fails says so, and does not also say it was saved
  diskFull = true
  toasts.length = 0
  if (!(await ui.find({ key: 'rf-ruleB' }))) await ui.press({ key: 'radd-rule' })
  await (ui as any).input({ key: 'rf-ruleB', text: 'Keep diffs small' } as never)
  expect(disk['/home/me/.claude/CLAUDE.md']).toBe('- Answer in British English\n')
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('Could not write')
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
  await openMore(ui)
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
  // YAML as people write it: a byte-order mark, spaces after ---, a space before the colon, a comment, any case of true
  const bom = '\uFEFF---  \nname: b\ndisable-model-invocation : True # keep it for /b\n---\nbody'
  expect(skillOf(bom)).toMatchObject({ name: 'b', auto: false, error: '' })
  expect(setInvocation(bom, true)).toBe('\uFEFF---  \nname: b\n---\nbody')
  expect(skillOf('---\ndisable-model-invocation: "true"\n---\n').auto).toBe(false)
  expect(skillOf('---\ndescription: a # b\n---\n').description).toBe('a')
  expect(skillOf('---\ndescription: "a # b"\n---\n').description).toBe('a # b')
  // A key written twice: off sets the first and drops the other, on drops both
  const twice = '---\ndisable-model-invocation: false\nname: t\ndisable-model-invocation: false\n---\n'
  expect(setInvocation(twice, false)).toBe('---\ndisable-model-invocation: true\nname: t\n---\n')
  expect(setInvocation('---\ndisable-model-invocation: true\nname: t\ndisable-model-invocation: true\n---\n', true)).toBe('---\nname: t\n---\n')
  // Mixed line endings: each line keeps its own, and the added line ends as the one before it
  const mixed = '---\r\nname: m\n---\r\nbody\r\n'
  expect(setInvocation(mixed, false)).toBe('---\r\nname: m\ndisable-model-invocation: true\n---\r\nbody\r\n')
  expect(setInvocation(setInvocation(mixed, false)!, true)).toBe(mixed)
  // An indented --- inside a block is not the end; a line that is not YAML's flat keys makes it unreadable
  const block = '---\nname: d\ndescription: |\n  ---\n  dashes\n---\nbody'
  expect(skillOf(block).description).toBe('--- dashes')
  expect(setInvocation(block, false)).toBe('---\nname: d\ndescription: |\n  ---\n  dashes\ndisable-model-invocation: true\n---\nbody')
  expect(skillOf('---\nname: x\n\tbad: tab\n---\n').error).toContain('line 3')
  expect(setInvocation('---\n[not, a, key]\n---\n', false)).toBe(null)
  // The line in the body is not the frontmatter's
  expect(skillOf('---\nname: x\n---\ndisable-model-invocation: true\n').auto).toBe(true)
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
  // An edit made by hand the moment after Cockpit first reads a file
  let editAfterRead: { path: string; text: string } | null = null
  on('fs.read', async (_: unknown, e: any) => {
    if (!(posix(e.path) in disk)) throw new Error('ENOENT')
    const now = disk[posix(e.path)]
    if (editAfterRead?.path === posix(e.path)) ((disk[editAfterRead.path] = editAfterRead.text), (editAfterRead = null))
    return { value: now } as never
  })
  on('fs.write', async (_: unknown, e: any) => (writes.push(posix(e.path)), (disk[posix(e.path)] = e.text), { value: undefined }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    return cmd === 'git rev-parse --show-toplevel' ? ok('/repo\n') : ok('')
  })
  on('command.run', async () => ({ text: '' }))
  await $.command.run({ command: 'cockpit', args: 'tab rules' } as never)
  const ui = await $.ui.mount(pane as never)
  await openMore(ui)
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
  // Edited by hand while the switch was worked out: nothing is written over the edit
  const edited = release.replace('Cut a release', 'Cut a careful release')
  editAfterRead = { path: '/repo/.claude/skills/release/SKILL.md', text: edited }
  const before = writes.length
  await ui.press({ key: 'sk-/repo/.claude/skills/release/SKILL.md' })
  expect(writes.length).toBe(before)
  expect(disk['/repo/.claude/skills/release/SKILL.md']).toBe(edited)
  expect(toasts.join('\n')).toContain('changed while it was being switched')
  expect(JSON.stringify(await ui.drawn())).toContain('Cut a careful release')
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

test('only a SKILL.md the tab listed may be written', async () => {
  const k = (path: string) => ({ path, folder: 'x', name: 'x', description: '', auto: true, error: '' })
  const skills = { repo: [k('/repo/.claude/skills/release/SKILL.md')], user: [k('/home/me/.claude/skills/notes/SKILL.md')] }
  expect(skillListed('/repo/.claude/skills/release/SKILL.md', skills)).toBe(true)
  expect(skillListed('/home/me/.claude/skills/notes/SKILL.md', skills)).toBe(true)
  // Not listed, another file in a listed folder, a path that only ends like a listed one, or nothing listed at all
  expect(skillListed('/repo/.claude/skills/other/SKILL.md', skills)).toBe(false)
  expect(skillListed('/repo/.claude/skills/release/script.sh', skills)).toBe(false)
  expect(skillListed('/evil/repo/.claude/skills/release/SKILL.md', skills)).toBe(false)
  expect(skillListed('/etc/passwd', skills)).toBe(false)
  expect(skillListed('/repo/.claude/skills/release/SKILL.md', undefined)).toBe(false)
  // A listed entry whose path is not a SKILL.md is never written either
  expect(skillListed('/repo/.claude/skills/x/README.md', { repo: [k('/repo/.claude/skills/x/README.md')], user: [] })).toBe(false)
})

test('what loads every session: @imports followed as Claude Code does, and the figures added up', async () => {
  // @imports: relative, from ~/ and absolute; not in code spans, fenced blocks or email addresses
  expect(importsOf('See @docs/style.md and @~/notes.md and @/etc/team.md.\nMail me@example.com\n`@not/this`\n```\n@nor/this\n```\n@../up.md')).toEqual(['docs/style.md', '~/notes.md', '/etc/team.md', '../up.md'])
  const disk: Record<string, string> = {
    '/repo/CLAUDE.md': '# Repo\n@docs/style.md\n@~/.claude/shared.md\n@gone.md\n',
    '/repo/docs/style.md': 'Use tabs.\n@../CLAUDE.md\n@deep/1.md\n',
    '/repo/docs/deep/1.md': '@2.md', '/repo/docs/deep/2.md': '@3.md', '/repo/docs/deep/3.md': '@4.md', '/repo/docs/deep/4.md': '@5.md', '/repo/docs/deep/5.md': 'end',
    '/home/me/.claude/shared.md': 'Shared rule\n',
    '/home/me/.claude/CLAUDE.md': '- Be brief\n',
  }
  const read = async (p: string) => disk[p] ?? null
  const files = await resolveMemory(['/repo/CLAUDE.md', '/repo/.claude/CLAUDE.md', '/home/me/.claude/CLAUDE.md'], read, '/home/me')
  // Breadth first: the start files, then each hop; .claude/CLAUDE.md does not exist and is left out
  expect(files.map(f => `${f.path}${f.via ? ` < ${f.via}` : ''}${f.missing ? ' (missing)' : ''}`)).toEqual([
    '/repo/CLAUDE.md',
    '/home/me/.claude/CLAUDE.md',
    '/repo/docs/style.md < /repo/CLAUDE.md',
    '/home/me/.claude/shared.md < /repo/CLAUDE.md',
    '/repo/gone.md < /repo/CLAUDE.md (missing)',
    // The cycle back to CLAUDE.md is not followed again; 4.md is the fifth hop, so 5.md is not read
    '/repo/docs/deep/1.md < /repo/docs/style.md',
    '/repo/docs/deep/2.md < /repo/docs/deep/1.md',
    '/repo/docs/deep/3.md < /repo/docs/deep/2.md',
    '/repo/docs/deep/4.md < /repo/docs/deep/3.md',
  ])
  // A file reached deep first and shallow later is still expanded at its shallowest: x is one hop from 0 here
  const chain: Record<string, string> = { '/r/0.md': '@1.md\n@x.md', '/r/1.md': '@2.md', '/r/2.md': '@3.md', '/r/3.md': '@4.md', '/r/4.md': '@x.md', '/r/x.md': '@y.md', '/r/y.md': '@z.md', '/r/z.md': 'end' }
  expect((await resolveMemory(['/r/0.md'], async p => chain[p] ?? null, '')).map(f => f.path)).toContain('/r/z.md')
  // Parsing as Claude Code reads it: no HTML comments, fences close on their own marker, backslashes and drives, no bare @/
  expect(importsOf('<!-- @hidden.md -->\n~~~\n@a.md\n```\n@b.md\n~~~\n@c.md\n@docs\\x.md @C:\\w\\y.md @/ @.')).toEqual(['c.md', 'docs\\x.md', 'C:\\w\\y.md'])
  // An @word that is not plainly a path is not a missing import; a file over the size cap, or binary, is listed, not read;
  // an import beyond the repository and your home is marked; ~/ with no home is skipped
  const odd: Record<string, MemoryRead> = { '/r/CLAUDE.md': '@types/node @alice @big.log @bin.dat @/etc/team.md @~/x.md @docs\\y.md', '/r/big.log': { skipped: 'over 1 MB' }, '/r/bin.dat': 'a\u0000b', '/etc/team.md': 'team', '/r/docs/y.md': 'win' }
  expect((await resolveMemory(['/r/CLAUDE.md'], async p => odd[p] ?? null, '', ['/r'])).map(f => `${f.path}${f.skipped ? ` [${f.skipped}]` : ''}${f.outside ? ' [outside]' : ''}`)).toEqual(['/r/CLAUDE.md', '/r/big.log [over 1 MB]', '/r/bin.dat [not text]', '/etc/team.md [outside]', '/r/docs/y.md'])
  // Where Claude Code looks: the folder it runs in and each above it (not /), then yours; Windows paths too
  expect(memoryStarts('/Users/me/work/repo/sub', '/Users/me')).toEqual([
    ...['/Users', '/Users/me', '/Users/me/work', '/Users/me/work/repo', '/Users/me/work/repo/sub'].flatMap(d => [`${d}/CLAUDE.md`, `${d}/.claude/CLAUDE.md`, `${d}/CLAUDE.local.md`]),
    '/Users/me/.claude/CLAUDE.md',
  ])
  expect(memoryStarts('C:\\work\\repo\\', 'C:\\Users\\me')).toEqual([...['C:/work', 'C:/work/repo'].flatMap(d => [`${d}/CLAUDE.md`, `${d}/.claude/CLAUDE.md`, `${d}/CLAUDE.local.md`]), 'C:/Users/me/.claude/CLAUDE.md'])
  expect(memoryStarts('/', '')).toEqual([])
  // The figures
  const skill = (name: string, description: string, auto = true, error = '') => ({ path: `/s/${name}/SKILL.md`, folder: name, name, description, auto, error })
  const skills = [skill('a', 'x'.repeat(398)), skill('b', 'short'), skill('c', 'y'.repeat(98)), skill('d', 'z'.repeat(40)), skill('off', 'q'.repeat(1000), false), skill('bad', 'w'.repeat(1000), true, 'broken')]
  const mcp = [{ state: 'on' }, { state: 'on' }, { state: 'off' }, { state: 'approval' }, { state: 'shadowed' }] as never
  const long = { path: '/repo/BIG.md', text: 'line\n'.repeat(201) }
  const load = startupLoad([{ path: '/repo/CLAUDE.md', text: 'abcdefgh\nij' }, long, { path: '/repo/gone.md', text: '', via: '/repo/CLAUDE.md', missing: true }], skills, mcp)
  // Each file with its lines, over 200 marked; a longer file costs more, a missing one nothing
  expect(load.files.map(f => `${f.path} ${f.lines}${f.long ? ' long' : ''}${f.missing ? ' missing' : ''}`)).toEqual(['/repo/CLAUDE.md 2', '/repo/BIG.md 201 long', '/repo/gone.md 0 missing'])
  const [small, big, gone] = load.files.map(f => f.tokens)
  expect(small).toBeGreaterThan(0)
  expect(big).toBeGreaterThan(small!)
  expect(gone).toBe(0)
  // A skill costs by its name and description; call-only and broken skills add nothing
  expect(load.skills.map(s => s.name)).toEqual(['a', 'b', 'c', 'd'])
  expect(load.largest.map(s => s.name)).toEqual(['a', 'c', 'd'])
  expect(load.mcpOn).toBe(2)
  // The total is every figure listed, added up
  expect(load.total).toBe([...load.files, ...load.skills].reduce((n, x) => n + x.tokens, 0))
  // An import outside the repository and your home, which loads only once approved, is not counted
  expect(startupLoad([{ path: '/etc/t.md', text: 'x'.repeat(400), via: '/r/CLAUDE.md', outside: true }], [], []).total).toBe(0)
  // Switching a skill to call only takes exactly its tokens off the total
  const lighter = startupLoad([{ path: '/repo/CLAUDE.md', text: 'abcdefgh\nij' }, long], skills.map(s => (s.name === 'a' ? { ...s, auto: false } : s)), mcp)
  expect(load.total - lighter.total).toBe(load.skills.find(s => s.name === 'a')!.tokens)
  expect(lighter.total).toBeLessThan(load.total)
})

test('the Rules tab shows what loads every session, from the real files and their imports, and Call only takes a skill off the total', { timeoutMs: 20_000 }, async ($, on) => {
  const bigSkill = '---\nname: big\ndescription: ' + 'A long description. '.repeat(20) + '\n---\n'
  const disk: Record<string, string> = {
    '/repo/CLAUDE.md': '# Repo\n- Run the tests\n@docs/style.md\n@gone.md\n',
    '/repo/docs/style.md': 'Use tabs.\n@/etc/team.md\n@big.log\n',
    '/etc/team.md': 'Team rules from outside the repository\n',
    '/repo/docs/big.log': 'x'.repeat(1_100_000),
    '/repo/CLAUDE.local.md': 'mine\n'.repeat(250),
    '/home/me/.claude/CLAUDE.md': '- Be brief\n',
    '/repo/.claude/skills/big/SKILL.md': bigSkill,
    '/repo/.claude/skills/small/SKILL.md': '---\nname: small\ndescription: tiny\n---\n',
    '/home/me/.claude/skills/quiet/SKILL.md': '---\nname: quiet\ndescription: never counted\ndisable-model-invocation: true\n---\n',
    '/repo/.mcp.json': JSON.stringify({ mcpServers: { on1: { command: 'a' }, waiting: { command: 'b' } } }),
    '/repo/.claude/settings.local.json': JSON.stringify({ enabledMcpjsonServers: ['on1'] }),
  }
  const writes: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('env.get', async (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.exists', async (_: unknown, e: any) => ({ value: posix(e.path) in disk }))
  on('fs.list', async (_: unknown, e: any) => {
    const dir = `${posix(e.path)}/`
    const kids = new Map<string, string>()
    for (const p of Object.keys(disk)) if (p.startsWith(dir)) { const [first, ...rest] = p.slice(dir.length).split('/'); kids.set(first!, rest.length ? 'dir' : 'file') }
    return { value: [...kids].map(([name, kind]) => ({ name, kind })) } as never
  })
  on('fs.stat', async (_: unknown, e: any) => {
    const p = posix(e.path)
    if (p in disk) return { value: { kind: 'file', size: disk[p]!.length, mtimeMs: 0, isLink: false } } as never
    if (Object.keys(disk).some(k => k.startsWith(`${p}/`))) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } as never
    throw new Error('ENOENT')
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
  await openMore(ui)
  const total = (d: string) => Number(d.match(/≈ ([\d,]+) tokens/)![1]!.replace(/,/g, ''))
  let d = JSON.stringify(await ui.drawn())
  expect(d).toContain('LOADS EVERY SESSION')
  // Each file by its path from the repository or from ~, with its lines and tokens
  expect(d).toContain('"CLAUDE.md"')
  expect(d).toContain('4 lines · ≈12')
  expect(d).toContain('↳ docs/style.md')
  expect(d).toContain('↳ gone.md')
  expect(d).toContain('"missing"')
  expect(d).toContain('250 lines · ≈313 · over 200')
  expect(d).toContain('~/.claude/CLAUDE.md')
  // A file over 1 MB is listed, not read; an import beyond the repository and home waits for approval, uncounted
  expect(d).toContain('↳ docs/big.log')
  expect(d).toContain('over 1 MB, not read')
  expect(d).toContain('↳ /etc/team.md')
  expect(d).toContain('outside, loads once approved')
  // Skills Claude may load: big and small, not the call-only one; the servers on, not the one waiting for approval
  expect(d).toContain('Skills Claude may load: 2')
  expect(d).not.toContain('quiet · ≈')
  expect(d).toContain('MCP servers on: 1')
  // Every figure adds up to the total shown
  // Every figure drawn adds up to the total shown: the four files that load (not the one from outside), and the two skills
  const figures = [...d.matchAll(/ lines · ≈(\d+)([^"]*)"/g)].filter(m => !m[2]!.includes('outside')).map(m => Number(m[1]))
  expect(figures).toHaveLength(4)
  const files = figures.reduce((a, b) => a + b, 0)
  const skill = (name: string) => Number(d.match(new RegExp(`"  ${name} · ≈(\\d+)"`))![1])
  const [big, small] = [skill('big'), skill('small')]
  expect(big).toBeGreaterThan(small)
  expect(total(d)).toBe(files + big + small)
  // Call only beside the largest skill: written to its SKILL.md, and the total drops by exactly its tokens
  await ui.press({ key: 'ld-/repo/.claude/skills/big/SKILL.md' })
  expect(disk['/repo/.claude/skills/big/SKILL.md']).toContain('disable-model-invocation: true')
  d = JSON.stringify(await ui.drawn())
  expect(total(d)).toBe(files + small)
  expect(d).toContain('Skills Claude may load: 1')
  expect(writes).toEqual(['/repo/.claude/skills/big/SKILL.md'])
  await ui.unmount()
})
