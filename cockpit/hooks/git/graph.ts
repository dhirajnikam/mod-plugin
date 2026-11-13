import { pushRun } from '../core/text'
import type { TextRun } from '../core/text'
import { AUTO } from '../core/theme'

// The commit graph laid out in lanes, one row a commit (newest first, topo order). For each row: the lane of its dot
// (col), whether a line comes into it from above (top) and leaves below (bottom), the lanes that pass straight
// through (through), the lanes that end in it, as branches merged or forked from it (into), and the lanes its other
// parents leave by (out), a merge's second parent opening a lane to the right
type GraphRow = { col: number; top: boolean; bottom: boolean; through: number[]; into: number[]; out: number[]; width: number }
export function graphRows(log: { sha: string; parents: string[] }[]): GraphRow[] {
  const lanes: (string | null)[] = []
  const free = (not: number) => {
    const i = lanes.findIndex((x, k) => x === null && k !== not)
    if (i >= 0) return i
    lanes.push(null)
    return lanes.length - 1
  }
  return log.map(c => {
    let col = lanes.indexOf(c.sha)
    const top = col >= 0
    if (col < 0) col = free(-1)
    const before = lanes.slice()
    const into = before.flatMap((x, i) => (x === c.sha && i !== col ? [i] : []))
    for (const i of into) lanes[i] = null
    const through = before.flatMap((x, i) => (x !== null && x !== c.sha && i !== col ? [i] : []))
    lanes[col] = c.parents[0] ?? null
    const out: number[] = []
    for (const p of c.parents.slice(1)) {
      let j = lanes.indexOf(p)
      if (j < 0 || j === col) {
        j = free(col)
        lanes[j] = p
      }
      out.push(j)
    }
    const width = Math.max(before.length, lanes.length, col + 1)
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    return { col, top, bottom: c.parents.length > 0, through, into, out, width }
  })
}
// Lane colours, cycled: distinct on light and dark. The first lane wears the accent
const LANE_COLORS = [AUTO.accent, '#4f8fe0', '#3f9b5f', '#c0609a', '#d39b2a', '#7a6fd0', '#2fa3a3', '#d0574f']
const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length] ?? AUTO.accent
// Where a lane's line runs across a row's SVG, and how wide the SVG is for that many lanes
const laneX = (i: number) => 9 + i * 14
export const graphWidth = (lanes: number) => laneX(Math.max(lanes, 1) - 1) + 9

// One row of the graph as SVG, for surfaces that draw it: rows stack with no gap, so their lines meet
export function graphSvg(r: GraphRow, width: number, node: 'plain' | 'head' | 'unpushed' | 'merge') {
  const h = 30
  const x = laneX
  const m = h / 2
  const w = graphWidth(width)
  const line = (i: number, y1: number, y2: number) => `<line x1="${x(i)}" y1="${y1}" x2="${x(i)}" y2="${y2}" stroke="${laneColor(i)}" stroke-width="2"/>`
  const curve = (from: number, y1: number, to: number, y2: number, c: string) =>
    `<path d="M${x(from)} ${y1} C${x(from)} ${(y1 + y2) / 2} ${x(to)} ${(y1 + y2) / 2} ${x(to)} ${y2}" fill="none" stroke="${c}" stroke-width="2"/>`
  const c = laneColor(r.col)
  const parts = [
    ...r.through.map(i => line(i, 0, h)),
    r.top ? line(r.col, 0, m) : '',
    r.bottom ? line(r.col, m, h) : '',
    ...r.into.map(i => curve(i, 0, r.col, m, laneColor(i))),
    ...r.out.map(j => curve(r.col, m, j, h, laneColor(j))),
    node === 'unpushed'
      ? `<circle cx="${x(r.col)}" cy="${m}" r="5" fill="none" stroke="${c}" stroke-width="2.4"/>`
      : node === 'head'
        ? `<circle cx="${x(r.col)}" cy="${m}" r="7" fill="none" stroke="${c}" stroke-width="1.6" opacity="0.6"/><circle cx="${x(r.col)}" cy="${m}" r="4.5" fill="${c}"/>`
        : node === 'merge'
          ? `<rect x="${x(r.col) - 4.5}" y="${m - 4.5}" width="9" height="9" rx="2" transform="rotate(45 ${x(r.col)} ${m})" fill="${c}"/>`
          : `<circle cx="${x(r.col)}" cy="${m}" r="4.5" fill="${c}"/>`,
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${parts.join('')}</svg>`
}
// One row of the graph as coloured text for the terminal: a cell per lane and one between, ● on the commit's lane,
// │ through, ╯ where a lane ends in it, ╮ where a lane leaves it, ─ joining them
export function graphText(r: GraphRow, width: number, node: string): TextRun[] {
  const cells: TextRun[] = Array.from({ length: Math.max(width, 1) * 2 - 1 }, () => ({ t: ' ' }))
  const put = (k: number, ch: string, lane: number) => {
    if (k >= 0 && k < cells.length) cells[k] = { t: ch, fg: laneColor(lane) }
  }
  for (const i of r.through) put(i * 2, '│', i)
  for (const i of [...r.into.map(k => [k, '╯'] as const), ...r.out.map(k => [k, '╮'] as const)]) {
    const [k, ch] = i
    const lo = Math.min(k, r.col), hi = Math.max(k, r.col)
    for (let q = lo * 2 + 1; q < hi * 2; q++) if (cells[q]?.t === ' ') put(q, '─', k)
    put(k * 2, k > r.col ? ch : ch === '╯' ? '╰' : '╭', k)
  }
  put(r.col * 2, node, r.col)
  const runs: TextRun[] = []
  for (const c of cells) pushRun(runs, c)
  return runs
}
