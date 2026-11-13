import { expect, test } from 'claude-code/testing'
import { ok } from './more'

// A folder holding two repos (api and web), and a plain single repo: which one git runs in, the picker, auto-follow
const PANE = { plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const SETUP = { commitMode: 'manual', setupDone: true, branchAuto: false, base: 'main' }

async function session($: any, on: any, root: string, repos: string[]) {
  const ran: { cmd: string; cwd: string }[] = []
  const store: Record<string, unknown> = Object.fromEntries(repos.map(r => [`git:${r}`, SETUP]))
  on('clock.now', async () => ({ value: 1_000_000 }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  on('session.cwd', async () => ({ value: root }))
  on('store.get', async (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', async (_: unknown, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('fs.list', async (_: unknown, e: any) => ({ value: e.path === root && repos.length > 1 ? ['api', 'web', 'node_modules', '.cache'].map(name => ({ name, kind: 'dir' })) : [] }))
  on('fs.exists', async (_: unknown, e: any) => ({ value: repos.some(r => e.path === `${r}/.git`) }))
  on('process.run', async (_: unknown, e: any) => {
    const argv = Object.values(e as object).find(Array.isArray) as string[]
    const cmd = argv.join(' ')
    const cwd = String(e.cwd ?? e.init?.cwd ?? '')
    ran.push({ cmd, cwd })
    if (cmd === 'git rev-parse --show-toplevel') return repos.length === 1 ? ok(`${repos[0]}\n`) : ok('', 128)
    // api is on main with one change, web on dev with two
    if (cmd.startsWith('git status')) {
      const sep = cmd.includes(' -z') ? '\0' : '\n'
      return ok((cwd.endsWith('web') ? ['## dev', ' M b.ts', ' M c.ts'] : ['## main', ' M a.ts']).join(sep) + sep)
    }
    return ok('')
  })
  await $.command.run({ command: 'cockpit', args: 'tab git' } as never)
  return { ran, store }
}
const statusCwds = (ran: { cmd: string; cwd: string }[]) => ran.filter(r => r.cmd.startsWith('git status')).map(r => r.cwd)
// The repository the picker shows as the one git runs in
const picked = async (ui: any) => (await ui.find({ key: 'git-repo' }))?.props.value

test('a folder of repos lists both, runs git in the first, and a hand pick switches', { timeoutMs: 20_000 }, async ($, on) => {
  const { ran } = await session($, on, '/work', ['/work/api', '/work/web'])
  const ui = await $.ui.mount(PANE as never)
  const d = JSON.stringify(await ui.drawn())
  // The picker names both, with branch and changed-file count; node_modules and dot folders are not repos
  expect(d).toContain('api')
  expect(d).toContain('web')
  expect(d).toContain('⎇ dev')
  expect(d).toContain('2 changed')
  expect(d).not.toContain('node_modules')
  expect(statusCwds(ran)).toContain('/work/api')
  expect(await picked(ui)).toBe('/work/api')
  ran.length = 0
  await (ui as any).select({ key: 'git-repo', value: '/work/web' })
  expect(statusCwds(ran)).toContain('/work/web')
  expect(await picked(ui)).toBe('/work/web')
  await ui.unmount()
})

test('an Edit in the other repo switches to it, unless one was picked by hand', { timeoutMs: 20_000 }, async ($, on) => {
  const { ran } = await session($, on, '/work2', ['/work2/api', '/work2/web'])
  const ui = await $.ui.mount(PANE as never)
  expect(await picked(ui)).toBe('/work2/api')
  ran.length = 0
  await $.tool.call({ tool: 'Edit', file_path: '/work2/web/src/b.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e1' } as never)
  expect(statusCwds(ran)).toContain('/work2/web')
  expect(await picked(ui)).toBe('/work2/web')
  await $.tool.call({ tool: 'Edit', file_path: '/work2/api/x.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e2' } as never)
  expect(await picked(ui)).toBe('/work2/api')
  // Picked by hand: edits no longer move it
  await (ui as any).select({ key: 'git-repo', value: '/work2/web' })
  expect(await picked(ui)).toBe('/work2/web')
  await $.tool.call({ tool: 'Edit', file_path: '/work2/api/y.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e3' } as never)
  expect(await picked(ui)).toBe('/work2/web')
  await ui.unmount()
})

test('a plain repository behaves as before: no picker, git runs at its top folder', { timeoutMs: 20_000 }, async ($, on) => {
  const { ran } = await session($, on, '/solo', ['/solo'])
  const ui = await $.ui.mount(PANE as never)
  const d = JSON.stringify(await ui.drawn())
  expect(d).not.toContain('git-repo')
  expect(d).toContain('⎇ main')
  expect(statusCwds(ran)).toEqual(['/solo'])
  await ui.unmount()
})
