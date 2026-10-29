import { expect, test } from 'claude-code/testing'
import { features, impactOf, memoryText, parseImports, resolveImport } from '../hooks/memory'

test('imports resolve to repository files across languages, and a change reaches what depends on it', async () => {
  const repo = new Set(['src/a.ts', 'src/b.tsx', 'types/index.d.ts', 'app/models.py', 'app/__init__.py', 'app/views.py', 'styles/base.css'])
  const has = (p: string) => repo.has(p)
  const ts = parseImports('src/a.ts', "import { b } from './b'\nimport type { T } from '../types'\nimport x from 'react'\nexport * from './b'\nconst c = await import('../styles/base.css')")
  expect(ts.map(x => resolveImport('src/a.ts', x, has))).toEqual(['src/b.tsx', 'types/index.d.ts', null, 'styles/base.css'])
  const py = parseImports('app/views.py', 'from .models import User\nfrom . import models\nimport os\nfrom app.models import Thing')
  expect([...new Set(py.map(x => resolveImport('app/views.py', x, has)).filter(Boolean))]).toEqual(['app/models.py'])
  const files = { 'src/a.ts': ['src/b.tsx', 'types/index.d.ts'], 'src/b.tsx': ['types/index.d.ts'], 'types/index.d.ts': [], 'app/views.py': ['app/models.py'], 'app/models.py': [] }
  const im = impactOf(files, 'types/index.d.ts')
  expect(im.usedBy.sort()).toEqual(['src/a.ts', 'src/b.tsx'])
  expect(im.features).toEqual(['src'])
  expect(impactOf(files, 'src/b.tsx').affected).toEqual(['src/a.ts'])
  expect(features(files).find(f => f.name === 'src')?.uses).toEqual(['types'])
  expect(memoryText(files)).toContain('- src (2 files: a.ts, b.tsx); uses types')
  expect(memoryText(files, 120).endsWith('- …')).toBe(true)
})

// A session against a small repository on an in-memory disk
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const PANE = { plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } }

test('each session maps the codebase into .cockpit, shows an edit\'s impact, tells Claude, and keeps history and Focus', async ($, on) => {
  const disk: Record<string, string> = {
    '/repo/src/a.ts': "import { b } from './b'\nimport c from '../lib/c'\n",
    '/repo/src/b.ts': "import c from '../lib/c'\n",
    '/repo/lib/c.ts': 'export default 1\n',
    '/repo/.cockpit/history.json': JSON.stringify({ version: 1, flows: [{ id: 'fOld', task: 'an older task', startedAt: 0, endedAt: 60000, status: 'done', reached: [], ops: 0, add: 3, del: 1, decisions: 0, commit: 'abc1234' }], agents: [], commits: [] }),
  }
  const store: Record<string, unknown> = { prefs: { focus: false, theme: 'auto', mode: 'auto', autoVerify: false, testAgents: true } }
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('session.append', async (_: unknown, e: any, next: any) => next(e))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 1, breakdown: { categories: [], totalTokens: 1000 } }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('config.list', async () => ({ value: [] }))
  on('store.get', async (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', async (_: unknown, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('fs.list', async () => ({ value: [] }))
  on('fs.exists', async (_: unknown, e: any) => ({ value: e.path in disk }))
  on('fs.read', async (_: unknown, e: any) => {
    if (!(e.path in disk)) throw new Error('ENOENT')
    return { value: disk[e.path] } as never
  })
  on('ui.panes', async () => ({ value: [] }) as never)
  on('fs.write', async (_: unknown, e: any) => ((disk[e.path] = e.text), { value: undefined }))
  on('agent.register', async (_: unknown, e: any) => ({ value: { agent: `cockpit:${e.name}` } }))
  on('command.register', async () => ({ value: {} }) as never)
  on('clock.every', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd === 'git rev-parse --show-toplevel') return ok('/repo\n')
    if (cmd.startsWith('git status')) return ok('## master\0')
    if (cmd.startsWith('git ls-files')) return ok('src/a.ts\0src/b.ts\0lib/c.ts\0')
    return ok('')
  })
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }) as never)
  on('tool.call', async () => ({ result: 'ok' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await new Promise(res => (globalThis as any).setTimeout(res, 300))

  // The memory is written into the repository, kept out of git
  expect(disk['/repo/.cockpit/.gitignore']).toContain('*')
  const mem = JSON.parse(disk['/repo/.cockpit/memory.json'] ?? '{}')
  expect(mem.files['lib/c.ts'].usedBy.sort()).toEqual(['src/a.ts', 'src/b.ts'])
  expect(disk['/repo/.cockpit/MEMORY.md']).toContain('## src')
  // Claude reads it in its system prompt
  const composed: any = await $.prompt.compose({ model: 'claude-x', promptModel: 'claude-x', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
  expect(composed.sections.map((x: any) => x.id)).toContain('cockpit:memory')
  expect(composed.sections.find((x: any) => x.id === 'cockpit:memory').text).toContain('src (2 files')

  // Focus off was kept from an earlier session: the status row is the full one
  const hint = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'PromptHint', requestId: 'hint', props: { isDraft: false, isWorking: false, hint: '' } } as never)
  expect(JSON.stringify(await hint.drawn())).toContain('"[cockpit]"')
  await hint.unmount()

  // An edit to lib/c.ts: Activity shows what it reaches
  await $.prompt.submit({ text: 'change c', command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  disk['/repo/lib/c.ts'] = "import { a } from '../src/a'\nexport default 2\n"
  await $.tool.call({ tool: 'Edit', file_path: '/repo/lib/c.ts', old_string: '1', new_string: '2', tool_use_id: 'e1' } as never)
  await $.command.run({ command: 'cockpit', args: 'tab files' } as never)
  const ui = await $.ui.mount(PANE as never)
  const d = JSON.stringify(await ui.drawn())
  expect(d).toContain('Impact · c.ts')
  expect(d).toContain('a.ts · b.ts')
  expect(d).toContain('2 files in src: check them')
  // The edit updated the memory: c.ts now imports a.ts
  expect(JSON.parse(disk['/repo/.cockpit/memory.json'] ?? '{}').files['lib/c.ts'].uses).toEqual(['src/a.ts'])
  await ui.unmount()

  // The turn ends: history is written, and the earlier session's flow shows in the Overview
  await $.turn.complete({ answer: 'done', reason: 'answer', turnId: 't', isAborted: false, durationMs: 1000 } as never)
  const hist = JSON.parse(disk['/repo/.cockpit/history.json'] ?? '{}')
  expect(hist.flows.map((f: any) => f.task)).toEqual(['an older task', 'change c'])
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ov = await $.ui.mount(PANE as never)
  const od = JSON.stringify(await ov.drawn())
  expect(od).toContain('Earlier sessions (1)')
  expect(od).toContain('an older task')
  await ov.unmount()
  // Focus switched on is kept for the next session
  await $.command.run({ command: 'cockpit', args: 'focus on' } as never)
  expect((store.prefs as any).focus).toBe(true)
})
