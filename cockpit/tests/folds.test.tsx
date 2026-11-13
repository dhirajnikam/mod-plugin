import { expect, test } from 'claude-code/testing'
import { TABS } from '../hooks/pane/tabs'
import { openMore } from './more'

// Every tab opens on its first lines; the rest sits behind its own More fold
test('every tab opens on its first lines with More folded, and each fold opens its own key', async ($, on) => {
  on('clock.now', async () => ({ value: 1_700_000_000_000 }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const cases = [['overview', 'Ready', 'fold-more', 'ctx-compact'], ['git', 'Working tree clean', 'fold-more-git', 'git-more'], ['agents', 'No agents running', 'fold-more-agents', 'spawn-toggle'], ['files', 'No edits yet this session', 'fold-more-activity', 'fold-feats'], ['rules', 'load before you type', 'fold-more-rules', 'rules-reload']] as const
  expect(cases.map(c => c[0]).sort()).toEqual(TABS.map(t => t.id).sort())
  for (const [tab, sentence, fold, hidden] of cases) {
    await $.command.run({ command: 'cockpit', args: `tab ${tab}` } as never)
    const ui = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} } } as never)
    // The Git tab opens on its setup, which has no More: once through it, the tab itself
    if (tab === 'git') for (const step of ['setup-next', 'setup-next', 'setup-next', 'setup-next', 'setup-done']) await ui.press({ key: step })
    let d = JSON.stringify(await ui.drawn())
    expect(d).toContain(sentence)
    expect(d).toContain('› More')
    expect(d).toContain(fold)
    expect(d).not.toContain(hidden)
    expect(await openMore(ui)).toBe(fold)
    d = JSON.stringify(await ui.drawn())
    expect(d).toContain('⌄ More')
    expect(d).toContain(hidden)
    await ui.unmount()
  }
})
