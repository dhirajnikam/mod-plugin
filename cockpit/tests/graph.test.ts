import { expect, test } from 'claude-code/testing'
import { graphRows, graphText } from '../hooks/logic'

// The terminal's graph: a merge opens a lane (╮), the branch's commit sits on it, the root takes it back (╯)
test('the commit graph draws as connected lane characters on the terminal', async () => {
  const log = [
    { sha: 'd', parents: ['b', 'c'] },
    { sha: 'c', parents: ['a'] },
    { sha: 'b', parents: ['a'] },
    { sha: 'a', parents: [] },
  ]
  const rows = graphRows(log)
  const text = rows.map(r => graphText(r, 2, '●').map(x => x.t).join(''))
  expect(text).toEqual(['●─╮', '│ ●', '● │', '●─╯'])
  // A straight history stays on one lane
  expect(graphRows([{ sha: 'b', parents: ['a'] }, { sha: 'a', parents: [] }]).map(r => r.width)).toEqual([1, 1])
})
