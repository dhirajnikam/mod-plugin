import { expect, test } from 'claude-code/testing'
import { changeHook, changeMcp, changePerm, changeRule, hookRows, mcpRows, parseSettings, permRows, ruleLines } from '../hooks/rules'

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
