import type { Ph } from '../../types'
import { memoryKey, memberOf, impactOf } from './memory'
import type { FeatureMark } from './memory-map'

// The Feature map's marks: the feature of the file being worked on is 'now', the ones edited this flow 'touched', the
// ones a change to the chosen file (or else the one edited last) reaches 'reached'
export function workMarks(s: Ph, now: string) {
  const files = s.memory.files
  const named = s.memory.features ?? []
  const of = (p: string) => {
    const k = memoryKey(files, p)
    return k ? memberOf(files, named, k) : ''
  }
  const cur = s.flows[s.flows.length - 1]
  const marks: Record<string, FeatureMark> = {}
  const lastEdit = [...s.ops].reverse().find(o => o.op === 'Write' || o.op === 'Edit')
  const key = memoryKey(files, s.ui.treeSel || lastEdit?.path || '')
  if (key) for (const f of impactOf(files, key, 3, named).features) marks[f] = 'reached'
  for (const o of s.ops) if ((o.op === 'Write' || o.op === 'Edit' || o.op === 'Delete') && (!cur || o.at >= cur.startedAt) && of(o.path)) marks[of(o.path)] = 'touched'
  if (now && of(now)) marks[of(now)] = 'now'
  return { marks, nowFeature: now ? of(now) : '' }
}
