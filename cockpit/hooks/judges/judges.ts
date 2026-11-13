import type { Decision } from '../../types'

// How many judges sit, by the decision's complexity
export const nJ = (score: number) => (score <= 3 ? 3 : score <= 6 ? 6 : 9)
// The judges' seats, in the order they are filled (their points of view are PERSONAS in judges/decisions.ts)
export const SEAT_NAMES = ['Pragmatist', 'Security', 'Maintainer', 'End user', 'Sceptic', 'Performance', 'Tester', 'Architect', 'Minimalist']
// The two-thirds bar
export const thrOf = (n: number) => Math.ceil((n * 2) / 3)
export function tally(d: Decision) {
  const n = d.votes.length
  const cast = d.votes.filter(v => v >= 0)
  const counts = d.opts.map((_, i) => cast.filter(v => v === i).length)
  const top = counts.reduce((b, c, i) => (c > (counts[b] ?? 0) ? i : b), 0)
  return { n, revealed: cast.length, counts, top, yes: counts[top] ?? 0, passes: (counts[top] ?? 0) >= thrOf(n) }
}
