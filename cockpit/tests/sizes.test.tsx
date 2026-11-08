import { expect, test } from 'claude-code/testing'

// Every computed run of text fits the width it is drawn in, from a narrow pane to a wide terminal
const WIDTHS = [28, 40, 60, 100, 160]
const TABS = ['overview', 'files', 'agents', 'git'] as const
const scroll = { offset: 0, bodyRows: 30 }

// Each row's text as drawn: a column Box starts new rows, anything else joins its row
const rows = (n: unknown): string[] => {
  // Bars and rules keep their length; other text wraps at its spaces, so only its longest word is rigid
  if (typeof n === 'string') return [/[━─]/.test(n) ? n.replace(/ +$/, '') : ' '.repeat(Math.max(0, ...n.split(/\s+/).map(x => x.length)))]
  if (!n || typeof n !== 'object') return []
  const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (el.props?.display === 'none') return []
  // A Button with no children draws its label, unbroken
  if (el.type === 'Button' && !(Array.isArray(el.children) && el.children.length)) return [' '.repeat(String(el.props?.label ?? '').length + 2)]
  const kids = (Array.isArray(el.children) ? el.children : []).map(rows)
  const pad = el.type === 'Box' ? Number(el.props?.paddingX ?? 0) * 2 + (el.props?.borderStyle ? 2 : 0) : 0
  if (el.type === 'Box' && (el.props?.flexDirection === 'column' || el.props?.flexWrap === 'wrap')) return kids.flat().map(r => r + ' '.repeat(pad))
  // A Text that wraps or truncates fits by itself
  if (el.type === 'Text' && el.props?.wrap && el.props.wrap !== 'wrap') return ['']
  if (el.type === 'Input' || el.type === 'Select' || el.type === 'Svg' || el.type === 'Raster') return ['']
  const gap = el.type === 'Box' ? Number(el.props?.gap ?? el.props?.columnGap ?? 0) : 0
  const lines = kids.filter(k => k.length)
  const width = lines.reduce((a, k) => a + Math.max(...k.map(s => s.length)), 0) + gap * Math.max(0, lines.length - 1) + pad
  return [' '.repeat(width)]
}

const wide = (tree: unknown, w: number) => rows(tree).filter(r => r.length > w).map(r => r.length)

// Every surface, tab and width: 4 to 5 s on a slow machine, past the 5 s default
test('the band, the pane and the chat cards fit every width', { timeoutMs: 20_000 }, async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  await $.tool.call({ tool: 'Edit', file_path: '/Users/someone/projects/app/src/features/authentication/login-form.tsx', old_string: 'a', new_string: 'b' } as never).catch(() => null)
  await $.tool.call({ tool: 'Read', file_path: '/Users/someone/projects/app/README.md' } as never).catch(() => null)
  const bad: string[] = []
  for (const focus of ['on', 'off']) {
    await $.command.run({ command: 'cockpit', args: `focus ${focus}` } as never)
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const w of WIDTHS) {
        const band = await $.ui.mount({ plugin: 'cockpit', surface, component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: w, scroll, view: {} } } as never)
        for (const n of wide(await band.drawn(), w)) bad.push(`${surface} band focus ${focus} @${w}: ${n}`)
        await band.unmount()
        for (const tab of TABS) {
          await $.command.run({ command: 'cockpit', args: `tab ${tab}` } as never)
          const pane = await $.ui.mount({ plugin: 'cockpit', surface, component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: w, placement: 'dock', scroll, view: {} } } as never)
          for (const n of wide(await pane.drawn(), w)) bad.push(`${surface} ${tab} @${w}: ${n}`)
          await pane.unmount()
        }
      }
    }
  }
  expect(bad).toEqual([])
})

// The Git tab's pull request row, with a long title, every kind of check and more failing checks than it lists
test("the Git tab's pull request fits every width, and draws pending and passing checks", { timeoutMs: 20_000 }, async ($, on) => {
  let checks = '[{"name":"build the whole monorepo on windows-latest","bucket":"fail"},{"name":"b","bucket":"fail"},{"name":"c","bucket":"cancel"},{"name":"d","bucket":"fail"},{"name":"lint","bucket":"pass"},{"name":"e2e","bucket":"pending"}]'
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_, e) => {
    const cmd = (e as unknown as { argv: string[] }).argv.join(' ')
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out('## feature/a-rather-long-branch-name-for-a-narrow-pane\0')
    if (cmd.startsWith('git branch')) return out('main\n')
    if (cmd.startsWith('gh pr view')) return out('{"number":1234,"title":"Make the authentication flow survive an expired refresh token on every platform","url":"u","state":"OPEN","isDraft":false,"reviewDecision":"CHANGES_REQUESTED"}')
    if (cmd.startsWith('gh pr checks')) return out(checks)
    return out('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const setup = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll, view: {} } } as never)
  for (const step of ['Account', 'Branch pattern', 'Message pattern', 'Commit mode', 'When']) await setup.press({ key: step === 'When' ? 'setup-done' : 'setup-next' })
  await setup.unmount()
  const bad: string[] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const w of WIDTHS) {
      const pane = await $.ui.mount({ plugin: 'cockpit', surface, component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: w, placement: 'dock', scroll, view: {} } } as never)
      const drawn = await pane.drawn()
      const text = JSON.stringify(drawn)
      for (const want of ['#1234', 'changes requested', '✓ 1 passed', '✗ 4 failed', '◌ 1 running', '+1 more failed']) if (!text.includes(want)) bad.push(`${surface} @${w}: no ${want}`)
      for (const n of wide(drawn, w)) bad.push(`${surface} git @${w}: ${n}`)
      await pane.unmount()
      // The band above the prompt names the branch too
      const band = await $.ui.mount({ plugin: 'cockpit', surface, component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: w, scroll, view: {} } } as never)
      for (const n of wide(await band.drawn(), w)) bad.push(`${surface} band @${w}: ${n}`)
      await band.unmount()
    }
  }
  // All passed: no failing rows
  checks = '[{"name":"lint","bucket":"pass"},{"name":"test","bucket":"pass"}]'
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  const pane = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 60, placement: 'dock', scroll, view: {} } } as never)
  const text = JSON.stringify(await pane.drawn())
  expect(text).toContain('✓ 2 passed')
  expect(text).not.toContain('failed')
  await pane.unmount()
  expect(bad).toEqual([])
})

// The Rules tab's MCP servers: a long command, a long URL, every state and many secret names
test("the Rules tab's MCP servers and skills fit every width", { timeoutMs: 20_000 }, async ($, on) => {
  const disk: Record<string, string> = {
    '/repo/.mcp.json': JSON.stringify({ mcpServers: { 'a-server-with-a-rather-long-name': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/someone/projects/a/very/deep/folder'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'x', ANOTHER_LONG_SECRET_NAME: 'y' } }, web: { type: 'http', url: 'https://mcp.example.com/a/very/long/path/to/the/server/endpoint' } } }),
    '/repo/.claude/skills/a-skill-folder-with-a-rather-long-name/SKILL.md': '---\nname: a-skill-with-a-rather-long-name-indeed\ndescription: Does a great many things, described at length so that the description runs well past the width of any narrow pane it is drawn in\n---\n',
    '/home/me/.claude/skills/notes/SKILL.md': '---\nname: notes\ndisable-model-invocation: true\n---\n',
    '/home/me/.claude.json': JSON.stringify({ mcpServers: { mine: { type: 'sse', url: 'https://live.example.com/sse' } }, projects: { '/repo': { mcpServers: { scratch: { command: 'scratch' } }, disabledMcpServers: ['web'] } } }),
  }
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('env.get', async (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.exists', async (_: unknown, e: any) => ({ value: String(e.path) in disk }))
  on('fs.list', async (_: unknown, e: any) => {
    const dir = `${String(e.path)}/`
    const kids = new Map<string, string>()
    for (const p of Object.keys(disk)) if (p.startsWith(dir)) { const [first, ...rest] = p.slice(dir.length).split('/'); kids.set(first!, rest.length ? 'dir' : 'file') }
    return { value: [...kids].map(([name, kind]) => ({ name, kind })) } as never
  })
  on('fs.read', async (_: unknown, e: any) => {
    if (!(String(e.path) in disk)) throw new Error('ENOENT')
    return { value: disk[String(e.path)] } as never
  })
  on('process.run', async (_, e) => {
    const cmd = (e as unknown as { argv: string[] }).argv.join(' ')
    return { value: { exitCode: 0, stdout: cmd === 'git rev-parse --show-toplevel' ? '/repo\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run({ command: 'cockpit', args: 'tab rules' } as never)
  const bad: string[] = []
  for (const scope of ['repo', 'user']) {
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const w of WIDTHS) {
        const pane = await $.ui.mount({ plugin: 'cockpit', surface, component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: w, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } } as never)
        if (scope === 'user' && surface === 'terminal' && w === WIDTHS[0]) await pane.press({ key: 'rscope-user' })
        const drawn = await pane.drawn()
        const text = JSON.stringify(drawn)
        for (const want of scope === 'repo' ? ['a-server-with-a-rather-long-name', 'needs approval', 'off', 'local, only you', 'a-skill-with-a-rather-long-name-indeed', 'Claude loads it'] : ['mine', 'sse', 'only when you call /notes']) if (!text.includes(want)) bad.push(`${scope} ${surface} @${w}: no ${want}`)
        for (const n of wide(drawn, w)) bad.push(`${scope} ${surface} rules @${w}: ${n}`)
        await pane.unmount()
      }
    }
  }
  expect(bad).toEqual([])
})
