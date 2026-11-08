import { expect, test } from 'claude-code/testing'
import { openMore } from './more'

// Agents, Activity and Rules open on one plain sentence; the rest sits behind their own More fold
test('Agents, Activity and Rules open on a sentence with More folded, and each fold opens its own key', async ($, on) => {
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
  const cases = [['agents', 'No agents running', 'fold-more-agents', 'spawn-toggle'], ['files', 'No edits yet this session', 'fold-more-activity', 'fold-feats'], ['rules', 'load before you type', 'fold-more-rules', 'rules-reload']] as const
  for (const [tab, sentence, fold, hidden] of cases) {
    await $.command.run({ command: 'cockpit', args: `tab ${tab}` } as never)
    const ui = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} } } as never)
    let d = JSON.stringify(await ui.drawn())
    if (tab !== 'rules') expect(d).toContain(sentence)
    expect(d).toContain('› More')
    expect(d).toContain(fold)
    expect(d).not.toContain(hidden)
    await openMore(ui)
    d = JSON.stringify(await ui.drawn())
    expect(d).toContain('⌄ More')
    expect(d).toContain(hidden)
    await ui.unmount()
  }
})
