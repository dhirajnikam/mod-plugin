import type { $ } from './core'
import { toast, set } from './core'

// The context window, made room in: Compact keeps a summary in the conversation's place (as /compact does), Clear starts
// the conversation afresh (as /clear does; the transcript stays in your history). Both wait for the session to be idle
export async function compactNow($: $) {
  const r = await $.session.compact({}).catch(e => ({ skip: String(e).includes('turn') ? 'a turn is running: try again when it ends' : String(e) }))
  await toast($, 'skip' in r && r.skip ? `Not compacted: ${r.skip}` : 'Compacted: a summary keeps the conversation')
  await measure($)
}

export async function clearNow($: $) {
  await set($, s => ({ ui: { ...s.ui, confirmClear: false } }))
  const r = await $.command.run({ command: 'clear' }).catch(e => ({ text: `Could not clear: ${String(e)}` }))
  await toast($, 'text' in r && r.text?.startsWith('Could not') ? r.text : 'Context cleared')
  await measure($)
}

export async function measure($: $) {
  const u = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  if (!u) return
  const cats = (u.context.breakdown?.categories ?? []).filter(c => c.tokens > 0 && !/free|buffer/i.test(c.name))
  const segs = cats
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 4)
    .map(c => [c.name, c.tokens] as [string, number])
  // Before the first API response `tokens` is unset: the breakdown's total stands in
  const used = u.context.tokens ?? u.context.breakdown?.totalTokens ?? 0
  const pct = u.context.percent ?? (u.context.window ? Math.round((used / u.context.window) * 100) : 0)
  await set($, {
    ctx: { pct, used, window: u.context.window, segs },
    cost: u.cost?.usd ?? 0,
    ...(u.startedAt ? { sessionAt: u.startedAt } : {}),
  })
}
