import type { Decision } from '../../types'

// The judges' seats, in the order they are filled: each its name and the point of view it judges from. A panel of n
// takes the first n
export const SEATS = [
  { name: 'Pragmatist', short: 'P', persona: 'a pragmatic senior engineer' },
  { name: 'Security', short: 'S', persona: 'a security reviewer' },
  { name: 'Maintainer', short: 'M', persona: 'a long-term maintainer' },
  { name: 'End user', short: 'U', persona: 'the end user' },
  { name: 'Sceptic', short: 'Sc', persona: 'a sceptic who prefers the safest option' },
  { name: 'Performance', short: 'Pf', persona: 'a performance engineer' },
  { name: 'Tester', short: 'T', persona: 'a test engineer' },
  { name: 'Architect', short: 'A', persona: 'a software architect' },
  { name: 'Minimalist', short: 'Mn', persona: 'a minimalist who prefers less code' },
]
export const SEAT_NAMES = SEATS.map(s => s.name)
export const seatShort = (i: number) => SEATS[i % SEATS.length]!.short
// A seat's mark on the bench: – abstained, ◌ still thinking, ✓ with the leader, × against
export const voteMark = (v: number, top: number) => (v === -2 ? '–' : v < 0 ? '◌' : v === top ? '✓' : '×')
// The models the seats vote with, in turn (the judgeModels setting): fast, all haiku; mixed and wide put bigger models
// on some seats, slower but with fewer blind spots shared by the whole panel
export const JUDGE_MODELS = { fast: ['haiku'], mixed: ['haiku', 'sonnet'], wide: ['haiku', 'sonnet', 'opus'] } as const
let panel: readonly string[] = JUDGE_MODELS.fast
export const setJudgeModels = (k: unknown) => void (panel = JUDGE_MODELS[k as keyof typeof JUDGE_MODELS] ?? JUDGE_MODELS.fast)
export const seatModel = (seat: number) => panel[seat % panel.length]!
// How many judges sit, by the decision's complexity: never more than there are seats
export const nJ = (score: number) => Math.min(score <= 3 ? 3 : score <= 6 ? 6 : 9, SEATS.length)
// The two-thirds bar
export const thrOf = (n: number) => Math.ceil((n * 2) / 3)
export function tally(d: Decision) {
  const n = d.votes.length
  const cast = d.votes.filter(v => v >= 0)
  const counts = d.opts.map((_, i) => cast.filter(v => v === i).length)
  const top = counts.reduce((b, c, i) => (c > (counts[b] ?? 0) ? i : b), 0)
  return { n, revealed: cast.length, counts, top, yes: counts[top] ?? 0, passes: (counts[top] ?? 0) >= thrOf(n) }
}
// The gavel: what the bench came to, or where it stands
export function gavel(d: Decision) {
  const t = tally(d)
  if (d.status === 'scoring') return 'scoring the case…'
  // An abstention has answered too: only a seat still thinking (-1) keeps the bench sitting
  const answered = d.votes.filter(v => v !== -1).length
  if (answered < t.n) return `${answered} of ${t.n} voted · needs ${thrOf(t.n)}`
  return t.passes ? `${t.yes} of ${t.n} · ${d.opts[t.top] ?? ''}  (needs ${thrOf(t.n)})` : `split ${t.counts.join('/')} · no ruling`
}
