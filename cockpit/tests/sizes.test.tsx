import { expect, test } from 'claude-code/testing'
import { TABS } from '../hooks/pane/tabs'
import { openMore } from './more'

// Every computed run of text fits the width it is drawn in, from a narrow pane to a wide terminal
const WIDTHS = [28, 40, 60, 100, 160]
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
  on('session.cwd', async () => ({ value: '/repo' }))
  on('process.run', async (_, e) => {
    const cmd = (e as unknown as { argv: string[] }).argv.join(' ')
    return { value: { exitCode: 0, stdout: cmd.startsWith('git status') ? '## feature/a-rather-long-branch-name-for-a-narrow-pane\0 M src/features/authentication/login-form.tsx\0' : cmd === 'git rev-parse --show-toplevel' ? '/repo\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
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
        for (const { id: tab } of TABS) {
          await $.command.run({ command: 'cockpit', args: `tab ${tab}` } as never)
          const pane = await $.ui.mount({ plugin: 'cockpit', surface, component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: w, placement: 'dock', scroll, view: {} } } as never)
          for (const n of wide(await pane.drawn(), w)) bad.push(`${surface} ${tab} @${w}: ${n}`)
          // The same tab with its More open, then folded again for the next width
          const fold = await openMore(pane)
          // The Git tab is on its setup here, which has no More; the test below measures the tab once set up
          if (!fold && tab !== 'git') bad.push(`${surface} ${tab} @${w}: no More to open`)
          if (fold) {
            for (const n of wide(await pane.drawn(), w)) bad.push(`${surface} ${tab} More @${w}: ${n}`)
            await pane.press({ key: fold })
          }
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
    if (cmd.startsWith('git status')) return out('## feature/a-rather-long-branch-name-for-a-narrow-pane\0 M src/features/authentication/login-form.tsx\0')
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
      // And with its More open, then folded again for the next width
      const fold = await openMore(pane)
      if (!fold) bad.push(`${surface} git @${w}: no More to open`)
      else {
        for (const n of wide(await pane.drawn(), w)) bad.push(`${surface} git More @${w}: ${n}`)
        await pane.press({ key: fold })
      }
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
  await openMore(pane)
  const text = JSON.stringify(await pane.drawn())
  expect(text).toContain('✓ 2 passed')
  expect(text).not.toContain('failed')
  await pane.unmount()
  expect(bad).toEqual([])
})

// The Rules tab's MCP servers: a long command, a long URL, every state and many secret names
test("the Rules tab's startup load, MCP servers and skills fit every width", { timeoutMs: 20_000 }, async ($, on) => {
  const disk: Record<string, string> = {
    '/repo/.mcp.json': JSON.stringify({ mcpServers: { 'a-server-with-a-rather-long-name': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/someone/projects/a/very/deep/folder'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'x', ANOTHER_LONG_SECRET_NAME: 'y' } }, web: { type: 'http', url: 'https://mcp.example.com/a/very/long/path/to/the/server/endpoint' } } }),
    '/repo/.claude/skills/a-skill-folder-with-a-rather-long-name/SKILL.md': '---\nname: a-skill-with-a-rather-long-name-indeed\ndescription: Does a great many things, described at length so that the description runs well past the width of any narrow pane it is drawn in\n---\n',
    '/home/me/.claude/skills/notes/SKILL.md': '---\nname: notes\ndisable-model-invocation: true\n---\n',
    '/repo/CLAUDE.md': '@docs/a/very/deeply/nested/folder/with/a/long/name/style-guide-for-everything.md\n@missing/also/a/long/path/to/nowhere.md\n' + 'x\n'.repeat(1200),
    '/repo/docs/a/very/deeply/nested/folder/with/a/long/name/style-guide-for-everything.md': 'Use tabs.\n',
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
  on('fs.stat', async (_: unknown, e: any) => {
    const p = String(e.path)
    if (p in disk) return { value: { kind: 'file', size: disk[p]!.length, mtimeMs: 0, isLink: false } } as never
    if (Object.keys(disk).some(k => k.startsWith(`${p}/`))) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } as never
    throw new Error('ENOENT')
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
        await openMore(pane)
        const drawn = await pane.drawn()
        const text = JSON.stringify(drawn)
        for (const want of scope === 'repo' ? ['a-server-with-a-rather-long-name', 'needs approval', 'off', 'local, only you', 'a-skill-with-a-rather-long-name-indeed', 'Claude loads it', 'LOADS EVERY SESSION', 'over 200', 'missing', 'MCP servers on: 2'] : ['mine', 'sse', 'only when you call /notes']) if (!text.includes(want)) bad.push(`${scope} ${surface} @${w}: no ${want}`)
        for (const n of wide(drawn, w)) bad.push(`${scope} ${surface} rules @${w}: ${n}`)
        await pane.unmount()
      }
    }
  }
  expect(bad).toEqual([])
})

// A worktree agent's row: its branch, what it changed, Bring back and Remove, and each confirm
test("a worktree agent's row fits every width, with its confirms", { timeoutMs: 20_000 }, async ($, on) => {
  on('clock.now', async () => ({ value: 1_700_000_000_000 }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('tool.check', async () => ({ decision: 'allow' }) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  let n = 0
  on('agent.spawn', async () => ({ model: 'haiku', agentId: `ag${++n}` }))
  on('process.run', async (_, e) => {
    const cmd = (e as unknown as { argv: string[] }).argv.join(' ')
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    if (cmd === 'git rev-parse --verify -q HEAD') return out('head1\n')
    if (cmd === 'git rev-parse --git-common-dir') return out('.git\n')
    if (cmd === 'git rev-parse --git-path cockpit-index') return out('.git/cockpit-index\n')
    if (cmd === 'git write-tree') return out('tree1\n')
    if (cmd.startsWith('git commit-tree')) return out('snap1\n')
    if (cmd.startsWith('git diff --numstat')) return out(Array.from({ length: 12 }, (_, i) => `120\t45\tsrc/features/authentication/a-rather-long-file-name-${i}.ts\0`).join(''))
    if (cmd.startsWith('git status')) return out('## main\0')
    return out('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab agents' } as never)
  const setup = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} } } as never)
  await openMore(setup)
  await setup.press({ key: 'spawn-toggle' })
  await setup.press({ key: 'spawn-wt' })
  await (setup as any).input({ key: 'spawn-task', text: 'refactor the whole authentication flow', kind: 'change' })
  await setup.press({ key: 'spawn-go' })
  await $.agent.spawn({ tool_use_id: 's1', prompt: 'refactor', description: 'refactor', subagentType: 'general-purpose', cwd: '/repo/.git/cockpit-worktrees/ag1700000000000-1', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'x', background: true, fork: false } as never)
  await $.turn.complete({ agentId: 'ag2', answer: 'REPORT: done', reason: 'answer', turnId: 'x', isAborted: false, durationMs: 1000 } as never)
  // The New agent form closed: this measures the agent's row
  await setup.press({ key: 'spawn-toggle' })
  await setup.unmount()
  const bad: string[] = []
  for (const ask of ['', 'back', 'rm']) {
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const w of WIDTHS) {
        const pane = await $.ui.mount({ plugin: 'cockpit', surface, component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: w, placement: 'dock', scroll: { offset: 0, bodyRows: 300 }, view: {} } } as never)
        if (ask && surface === 'terminal' && w === WIDTHS[0]) await pane.press({ key: `wt-${ask}-ag2` })
        const drawn = await pane.drawn()
        const text = JSON.stringify(drawn)
        const want = ask === 'back' ? 'Apply its changes to your files?' : ask === 'rm' ? 'Remove the worktree (its branch stays)?' : '12 files +1440 −540'
        if (!text.includes(want)) bad.push(`${ask || 'row'} ${surface} @${w}: no ${want}`)
        for (const k of wide(drawn, w)) bad.push(`${ask || 'row'} ${surface} agents @${w}: ${k}`)
        await pane.unmount()
      }
      if (ask && surface === 'desktop') {
        const pane = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 300 }, view: {} } } as never)
        await pane.press({ key: 'wt-no-ag2' })
        await pane.unmount()
      }
    }
  }
  expect(bad).toEqual([])
})

// The Overview's Earlier sessions with spend: a bar per day, the totals and the costliest sessions
test("the Overview's spend by day and costliest sessions fit every width", { timeoutMs: 20_000 }, async ($, on) => {
  const day = (d: number, h = 12) => new Date(2026, 10, d, h).getTime()
  const sessions = [3, 4, 6, 7, 8].map((d, i) => ({ id: `s${d}`, startedAt: day(d), endedAt: day(d) + 9_000_000, usd: [12.34, 0.5, 103.2, 7, 1.25][i], tokens: 1000, turns: 40 + i }))
  const disk: Record<string, string> = { '/repo/.cockpit/history.json': JSON.stringify({ version: 1, flows: [], agents: [], commits: [], sessions }) }
  on('clock.now', async () => ({ value: day(8, 18) }))
  on('clock.every', async () => ({ value: {} }) as never)
  on('command.register', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('fs.read', async (_: unknown, e: any) => {
    if (!(String(e.path) in disk)) throw new Error('ENOENT')
    return { value: disk[String(e.path)] } as never
  })
  on('fs.write', async () => ({ value: undefined }))
  on('process.run', async (_, e) => {
    const cmd = (e as unknown as { argv: string[] }).argv.join(' ')
    return { value: { exitCode: cmd.startsWith('git rev-parse --verify') ? 1 : 0, stdout: cmd === 'git rev-parse --show-toplevel' ? '/repo\n' : cmd.startsWith('git status') ? '## main\0' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never).catch(() => null)
  await new Promise(res => (globalThis as any).setTimeout(res, 50))
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const bad: string[] = []
  let opened = false
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const w of WIDTHS) {
      const pane = await $.ui.mount({ plugin: 'cockpit', surface, component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: w, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} } } as never)
      if (!opened) {
        await openMore(pane)
        await pane.press({ key: 'fold-past' })
        opened = true
      }
      const drawn = await pane.drawn()
      const text = JSON.stringify(drawn)
      for (const want of ['Spend, last 14 days ≈ $124.29', 'Costliest sessions', '$103.20']) if (!text.includes(want)) bad.push(`${surface} @${w}: no ${want}`)
      for (const n of wide(drawn, w)) bad.push(`${surface} spend @${w}: ${n}`)
      await pane.unmount()
    }
  }
  expect(bad).toEqual([])
})
