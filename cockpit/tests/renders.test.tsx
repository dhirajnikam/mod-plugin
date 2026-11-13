import { expect, test } from 'claude-code/testing'
import { TABS } from '../hooks/pane/tabs'
import { cockpitParts, openMore } from './more'

// Every render hook, on the terminal and the desktop, with Focus on and off, and every pane tab
const scroll = { offset: 0, bodyRows: 30 }
const SITES = [
  { component: 'Spinner', requestId: 'sp', props: { word: 'Working', message: null, suffix: '', mode: 'tool-use' } },
  { component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 90, scroll, view: {} } },
  { component: 'PromptHint', requestId: 'hint', props: { isDraft: false, isWorking: true, hint: '' } },
  { component: 'UserMessage', requestId: 'um', props: { text: 'fix the login', origin: { kind: 'composer' }, isExpanded: false } },
  { component: 'AssistantMessage', requestId: 'am', props: { text: 'Done **now**', isFirstOfReply: true } },
  { component: 'TurnDuration', requestId: 'td', props: { word: 'Done', durationMs: 65000 } },
  { component: 'ToolUse', requestId: 'tu1', props: { tool_use_id: 'tu1', tool: 'Edit', input: { file_path: '/x/a.ts', old_string: 'a', new_string: 'b\nc' }, isRunning: false, isErrored: false, isInterrupted: false } },
  { component: 'ToolUse', requestId: 'tu2', props: { tool_use_id: 'tu2', tool: 'Bash', input: { command: 'git commit -m x' }, output: '[main abc1234] feat: x', isRunning: false, isErrored: false, isInterrupted: false } },
  { component: 'ToolUse', requestId: 'tu3', props: { tool_use_id: 'tu3', tool: 'Agent', input: { description: 'look around', subagent_type: 'Explore' }, isRunning: true, isErrored: false, isInterrupted: false } },
  { component: 'ToolGroup', requestId: 'tg', props: { calls: [{ tool: 'Read', input: { file_path: '/x/a.ts' }, tool_use_id: 'r1' }, { tool: 'Grep', input: { pattern: 'foo' }, tool_use_id: 'g1' }], isActive: false, isExpanded: false } },
] as const

const text = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as { children?: unknown[] }).children ?? []).map(text).join('') : '')

// Buttons whose label hides their children: the desktop draws the label alone
const labelled = (n: unknown): string[] => {
  if (!n || typeof n !== 'object') return []
  const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const kids = Array.isArray(el.children) ? el.children : []
  const own = el.type === 'Button' && kids.length && String(el.props?.label ?? '').trim() !== text(el).trim() ? [String(el.props?.label)] : []
  return [...own, ...kids.flatMap(labelled)]
}

for (const surface of ['terminal', 'desktop'] as const) {
  // Every render, tab and Focus setting on one surface: about a second quiet, past the 5 s default when the machine is busy
  test(`every render draws on ${surface}, Focus on and off`, { timeoutMs: 20_000 }, async ($, on) => {
    on('clock.now', async () => ({ value: 1_000_000 }))
    on('ui.toast', async () => ({ value: undefined }))
    const messages: unknown[] = []
    on('ui.render', async (_, e) => {
      if (e.component === 'Spinner') messages.push((e.props as { message: unknown }).message)
      const { Text } = _.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    on('tool.call', async () => ({ result: 'ok' }) as never)
    on('ui.open', async () => ({ value: { isPlaced: true } }))
    on('session.cwd', async () => ({ value: '/repo' }))
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async () => ({ value: undefined }))
    on('process.run', async (_, e) => {
      const cmd = (e as unknown as { argv: string[] }).argv.join(' ')
      return { value: { exitCode: 0, stdout: cmd.startsWith('git status') ? '## main\0 M a.txt\0' : cmd === 'git rev-parse --show-toplevel' ? '/repo\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    // Lay an Edit op so the ToolUse card has something to draw
    await $.tool.call({ tool: 'Edit', tool_use_id: 'tu1', file_path: '/x/a.ts', old_string: 'a', new_string: 'b\nc' } as never).catch(() => null)
    for (const focus of ['on', 'off']) {
      await $.command.run({ command: 'cockpit', args: `focus ${focus}` } as never)
      for (const site of SITES) {
        const ui = await $.ui.mount({ plugin: 'cockpit', surface, ...site } as never)
        expect(labelled(await ui.drawn())).toEqual([])
        // Cockpit's own drawing: on the band the engine's row sits beside it and is not Cockpit's to hide
        const mine = cockpitParts(await ui.drawn())
        const drawn = JSON.stringify(mine)
        // Focus on hides tool cards; the turn's line stays, as its outcome; everything else is cockpit's own
        const hidden = focus === 'on' && (site.component === 'ToolUse' || site.component === 'ToolGroup')
        // The desktop draws its own spinner row, with Cockpit's words
        const engineSpinner = surface !== 'terminal' && site.component === 'Spinner'
        if (engineSpinner) expect(messages.pop()).toBe('Editing a.ts')
        else if (!hidden && site.requestId !== 'tu3') {
          expect(mine.length).toBeGreaterThan(0)
          expect(drawn).not.toContain('ENGINE')
        }
        if (hidden) expect(mine).toEqual([expect.objectContaining({ props: expect.objectContaining({ display: 'none' }) })])
        await ui.unmount()
      }
      for (const { id: tab } of TABS) {
        await $.command.run({ command: 'cockpit', args: `tab ${tab}` } as never)
        const pane = await $.ui.mount({ plugin: 'cockpit', surface, component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll, view: {} } } as never)
        expect(JSON.stringify(await pane.drawn())).not.toContain('needs a surface')
        expect(labelled(await pane.drawn())).toEqual([])
        // The Git tab opens on its setup, which has no More: once through it, the tab itself
        if (tab === 'git' && focus === 'on') for (const step of ['setup-next', 'setup-next', 'setup-next', 'setup-next', 'setup-done']) await pane.press({ key: step })
        // And with the tab's More open: the first pass opens it, the second finds it open
        if (focus === 'on') expect(await openMore(pane)).toMatch(/^fold-more/)
        const open = JSON.stringify(await pane.drawn())
        expect(open).toContain('⌄ More')
        expect(open).not.toContain('needs a surface')
        expect(labelled(await pane.drawn())).toEqual([])
        await pane.unmount()
      }
    }
  })
}
