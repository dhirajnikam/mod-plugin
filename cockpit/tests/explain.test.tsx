import { expect, test } from 'claude-code/testing'
import { explainPrompt } from '../hooks/ops/explain'

const scroll = { offset: 0, bodyRows: 60 }
const PANE = { plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll, view: {} } }

const out = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const wait = () => new Promise(r => (globalThis as any).setTimeout(r, 300))
const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

// The engine stood in with a repository at /repo whose files are the keys of `disk`
function stand($: unknown, on: any, disk: Record<string, string>) {
  const asked: string[] = []
  on('clock.after', async (_: unknown, e: any) => (await new Promise(res => (globalThis as any).setTimeout(res, e.ms)), { value: undefined }) as never)
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async (_: unknown, e: any) => (asked.push('TOAST ' + e.text), { value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('fs.exists', async (_: unknown, e: any) => ({ value: posix(e.path) in disk || Object.keys(disk).some(k => k.startsWith(`${posix(e.path)}/`)) }))
  on('fs.stat', async () => ({ value: { kind: 'file', size: 10, mtimeMs: 1_700_000_000_000, isLink: false } }))
  on('fs.read', async (_: unknown, e: any) => ({ value: disk[posix(e.path)] ?? '' }))
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (Object.values(e as object).find(Array.isArray) as string[]).join(' ')
    if (cmd.startsWith('git rev-parse --show-toplevel')) return out('/repo\n')
    if (cmd.startsWith('git log')) return out('src/a.ts\nsrc/a.ts\nsrc/b.ts\n')
    if (cmd.startsWith('git status')) return out('## main\0')
    return out('')
  })
  on('prompt.submit', async (_: unknown, e: any) => (asked.push(String(e.text)), { text: e.text }))
  return asked
}

test('explainPrompt names the path and every section, and a refresh keeps the person\'s edits', () => {
  const p = explainPrompt({ path: 'docs/CODEBASE.md', exists: false, memory: '- core: the core', readme: '# Proj', recent: ['src/a.ts'] })
  for (const w of ['docs/CODEBASE.md', 'What the project is for', 'laid out', 'flows through', 'design decisions', 'build, test and run', 'Where to start', '400 lines', '- core: the core', '# Proj', 'src/a.ts']) expect(p).toContain(w)
  expect(explainPrompt({ path: 'CODEBASE.md', exists: true, memory: '', readme: '', recent: [] })).toContain('keep every edit the person made by hand')
})

test('/cockpit explain hands Claude the prompt: docs/CODEBASE.md when there is a docs folder, CODEBASE.md when there is none', { timeoutMs: 20_000 }, async ($, on) => {
  const asked = stand($, on, { '/repo/docs/guide.md': '', '/repo/README.md': '# My project\nIt does things' })
  await $.command.run({ command: 'cockpit', args: 'explain' } as never)
  await wait()
  expect(asked[0]).toContain('docs/CODEBASE.md')
  expect(asked[0]).toContain('How it is laid out')
  expect(asked[0]).toContain('# My project')
  expect(asked[0]).toContain('src/a.ts')
})

test('with no docs folder the guide goes at the root', { timeoutMs: 20_000 }, async ($, on) => {
  const asked = stand($, on, { '/repo/src/a.ts': '' })
  await $.command.run({ command: 'cockpit', args: 'explain' } as never)
  await wait()
  expect(asked[0]).toContain('guide at CODEBASE.md')
  expect(asked[0]).not.toContain('docs/CODEBASE.md')
})

test('the Overview row asks when the guide is missing, and offers Open, Refresh and an input when it is there', { timeoutMs: 20_000 }, async ($, on) => {
  const disk: Record<string, string> = { '/repo/docs/guide.md': '' }
  const asked = stand($, on, disk)
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  const ui = await $.ui.mount(PANE as never)
  expect(await ui.find({ key: 'guide-explain' })).toBeTruthy()
  expect(await ui.find({ key: 'guide-edit' })).toBeFalsy()
  disk['/repo/docs/CODEBASE.md'] = '# Guide'
  await $.command.run({ command: 'cockpit', args: 'tab overview' } as never)
  expect(await ui.find({ key: 'guide-explain' })).toBeFalsy()
  expect(await ui.find({ key: 'guide-open' })).toBeTruthy()
  expect(JSON.stringify(await ui.drawn())).toContain('docs/CODEBASE.md')
  await ui.press({ key: 'guide-refresh' })
  await wait()
  expect(asked.some(a => a.includes('Refresh the codebase guide at docs/CODEBASE.md'))).toBe(true)
  await (ui as any).input({ key: 'guide-edit', text: 'add a section on testing', kind: 'submit' })
  await wait()
  expect(asked).toContain('Edit docs/CODEBASE.md: add a section on testing')
  await ui.unmount()
})
