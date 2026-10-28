import { expect, test } from 'claude-code/testing'

import { ringRuns } from '../hooks/logic'

// The ring is 14 cells wide on every row, shows its percentage in the middle row, and fills with the accent as it grows
test('the progress ring is well-formed text', async () => {
  for (const pct of [0, 40, 100]) {
    const rows = ringRuns(pct, 'A', 'T', 'I')
    expect(rows.length).toBe(7)
    for (const runs of rows) expect(runs.reduce((n, r) => n + r.t.length, 0)).toBe(14)
    expect(rows[3]!.map(r => r.t).join('')).toContain(`${pct}%`)
    const accent = rows.flat().filter(r => r.fg === 'A' || r.bg === 'A').length
    const track = rows.flat().filter(r => r.fg === 'T' || r.bg === 'T').length
    if (pct === 0) expect(accent).toBe(0)
    if (pct === 100) expect(track).toBe(0)
    if (pct === 40) expect(accent > 0 && track > 0).toBe(true)
  }
})
