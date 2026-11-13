// The feature map: the features laid out in layers by what uses what, drawn as SVG and in characters
import { esc, cutTrim, plural } from '../core/text'
import { SVG_TONES, realColors } from '../core/theme'
import type { Feature } from './memory'

// The feature map's layers: a feature sits one layer below the deepest feature that uses it, so what uses sits above
// what it uses and the foundations land at the bottom. A use that closes a loop (found by a walk in the features'
// order) is set aside first, so a cycle doesn't pull the rest of the map onto one layer
// ponytail: longest-path layering with one ordering pass, no crossing minimisation; enough for a few dozen features
export function featureLayers(fs: Feature[]) {
  const down = acyclicUses(fs)
  const depth = new Map(fs.map(f => [f.name, 0]))
  for (let round = 0, moved = true; moved && round < fs.length; round++) {
    moved = false
    for (const f of fs)
      for (const u of down.get(f.name) ?? [])
        if ((depth.get(u) ?? 0) < (depth.get(f.name) ?? 0) + 1) {
          depth.set(u, (depth.get(f.name) ?? 0) + 1)
          moved = true
        }
  }
  const layers: string[][] = []
  for (const f of fs) (layers[depth.get(f.name) ?? 0] ??= []).push(f.name)
  // Each layer ordered under the features that use it, so the arrows run short
  const at = new Map<string, number>()
  return layers.filter(Boolean).map(layer => {
    const users = (n: string) => fs.filter(f => f.uses.includes(n) && at.has(f.name)).map(f => at.get(f.name)!)
    const mid = (n: string) => (users(n).length ? users(n).reduce((a, b) => a + b, 0) / users(n).length : Infinity)
    const sorted = [...layer].sort((a, b) => mid(a) - mid(b) || a.localeCompare(b))
    sorted.forEach((n, i) => at.set(n, i / Math.max(1, sorted.length - 1)))
    return sorted
  })
}

// Each feature's uses less the ones that close a loop: a depth-first walk drops each use that points back to a feature
// still on the walk's path
function acyclicUses(fs: { name: string; uses: string[] }[]) {
  const names = new Set(fs.map(f => f.name))
  const of = new Map(fs.map(f => [f.name, f.uses.filter(u => names.has(u) && u !== f.name)]))
  const down = new Map<string, string[]>(fs.map(f => [f.name, []]))
  const state = new Map<string, 'on' | 'done'>()
  const walk = (n: string) => {
    state.set(n, 'on')
    for (const u of of.get(n) ?? []) {
      if (state.get(u) === 'on') continue
      down.get(n)!.push(u)
      if (!state.has(u)) walk(u)
    }
    state.set(n, 'done')
  }
  for (const f of fs) if (!state.has(f.name)) walk(f.name)
  return down
}

// How a feature stands in the work: being worked on this moment, changed this flow, reached by the last change
export type FeatureMark = 'now' | 'touched' | 'reached'

// The feature map as SVG for surfaces that draw it: a box per feature in its layer, an arrow from each feature to every
// feature it uses. The feature being worked on is filled and breathes, the ones changed this flow are outlined in the
// accent, the ones a change reaches are dashed; the arrows between marked features carry the accent too
export function featureMapSvg(fs: Feature[], marks: Record<string, FeatureMark>, c: { accent: string; busy: string; text: string; dim: string; track: string; bg: string }, width = 640) {
  c = realColors(c, { ...SVG_TONES, bg: 'rgba(0,0,0,0)' })
  // Sized to be read at a glance: 15px names in 36px boxes, a row of air between layers for the arrows
  const H = 36
  const GAP = 12
  const ROW = 84
  const FONT = 15
  const boxW = (n: string) => Math.min(width / 2, cutTrim(n, 30).length * FONT * 0.58 + 30)
  // A layer wider than the canvas wraps onto rows of its own
  const rows: string[][] = []
  for (const layer of featureLayers(fs)) {
    let row: string[] = []
    let used = 0
    for (const n of layer) {
      const wN = boxW(n)
      if (row.length && used + wN > width) {
        rows.push(row)
        row = []
        used = 0
      }
      row.push(n)
      used += wN + GAP
    }
    if (row.length) rows.push(row)
  }
  const box = new Map<string, { x: number; y: number; w: number }>()
  rows.forEach((row, r) => {
    const ws = row.map(boxW)
    const total = ws.reduce((a, b) => a + b, 0) + GAP * (row.length - 1)
    let x = (width - total) / 2
    row.forEach((n, i) => {
      box.set(n, { x, y: 10 + r * ROW, w: ws[i]! })
      x += ws[i]! + GAP
    })
  })
  // Cropped to the boxes: the surface draws the markup at its own size up to the pane's width and shrinks only what is
  // wider, so empty canvas either side would shrink the names with it
  const left = Math.min(...[...box.values()].map(b => b.x))
  const right = Math.max(...[...box.values()].map(b => b.x + b.w))
  for (const b of box.values()) b.x += 10 - left
  width = Math.ceil(right - left + 20)
  const height = 10 + rows.length * ROW - (ROW - H) + 10
  const hot = (n: string) => marks[n] === 'now' || marks[n] === 'touched'
  const uses = new Map(fs.map(f => [f.name, f.uses.filter(u => box.has(u) && u !== f.name)]))
  // a → c is implied when a reaches c through another feature it uses, walking only uses that close no loop (a loop
  // would make every use look implied): that arrow is left out unless it is lit
  const kept = acyclicUses(fs)
  const via = (a: string, c: string) => {
    const seen = new Set<string>()
    const walk = (n: string): boolean => (kept.get(n) ?? []).some(m => m === c || (!seen.has(m) && (seen.add(m), walk(m))))
    return (kept.get(a) ?? []).some(b => b !== c && walk(b))
  }
  const edges = fs.flatMap(f =>
    (uses.get(f.name) ?? []).filter(() => box.has(f.name)).map(u => {
      const a = box.get(f.name)!
      const b = box.get(u)!
      const down = b.y > a.y
      const x1 = a.x + a.w / 2
      const y1 = down ? a.y + H : a.y
      const x2 = b.x + b.w / 2
      const y2 = down ? b.y - 3 : b.y + H + 3
      const bend = Math.max(24, Math.abs(y2 - y1) / 2)
      const lit = (hot(f.name) || marks[f.name] === 'reached') && (hot(u) || marks[u] === 'reached')
      // A use back up a loop is always left out, lit or not, as the terminal leaves it (loopUses counts them, under the map)
      if (!kept.get(f.name)?.includes(u) || (!lit && via(f.name, u))) return ''
      return `<path d="M${x1.toFixed(1)} ${y1} C${x1.toFixed(1)} ${y1 + (down ? bend : -bend)} ${x2.toFixed(1)} ${y2 + (down ? -bend : bend)} ${x2.toFixed(1)} ${y2}" fill="none" stroke="${lit ? c.accent : c.track}" stroke-width="${lit ? 2.2 : 1.3}" stroke-opacity="${lit ? 1 : 0.55}" marker-end="url(#${lit ? 'ah' : 'a'})"/>`
    }),
  )
  const nodes = [...box].map(([n, b]) => {
    const m = marks[n]
    const stroke = m === 'now' ? c.busy : m === 'touched' ? c.accent : m === 'reached' ? c.busy : c.track
    const fill = m === 'now' ? c.busy : c.bg
    const ink = m === 'now' ? '#1c1b1a' : m ? c.text : c.dim
    const pulse = m === 'now' ? `<animate attributeName="opacity" values="1;0.55;1" dur="1.6s" repeatCount="indefinite"/>` : ''
    const f = fs.find(x => x.name === n)
    // Hovering a box tells what the feature does and what it uses (the frame draws <title> as a tooltip)
    const tip = `<title>${esc([n, f?.what ?? '', f?.uses.length ? `uses ${f.uses.join(', ')}` : '', f?.files.length ? plural(f.files.length, 'file') : ''].filter(Boolean).join('\n'))}</title>`
    return `<g>${tip}<rect x="${b.x.toFixed(1)}" y="${b.y}" width="${b.w.toFixed(1)}" height="${H}" rx="10" fill="${fill}" fill-opacity="${m === 'now' ? 0.9 : 1}" stroke="${stroke}" stroke-width="${m ? 2.2 : 1.3}"${m === 'reached' ? ' stroke-dasharray="5 4"' : ''}>${pulse}</rect>` +
      `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${b.y + H / 2 + FONT * 0.35}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${FONT}" font-weight="${m ? 600 : 400}" fill="${ink}">${esc(cutTrim(n, 30))}</text></g>`
  })
  const arrow = (id: string, col: string) => `<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="${col}"/></marker>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs>${arrow('a', c.track)}${arrow('ah', c.accent)}</defs>${edges.join('')}${nodes.join('')}</svg>`
}

// How many uses close a loop, which the character map leaves out
export function loopUses(nodes: { name: string; uses: string[] }[]) {
  const names = new Set(nodes.map(f => f.name))
  const down = acyclicUses(nodes)
  return nodes.reduce((a, f) => a + f.uses.filter(u => names.has(u) && u !== f.name).length - (down.get(f.name)?.length ?? 0), 0)
}

// How a cell of the character map is coloured: an edge (lit when both its ends are marked), a box's border by its
// feature's mark, or a name
export type MapTone = 'line' | 'lit' | 'box' | 'name' | 'name-now' | 'name-marked' | 'note' | FeatureMark

// The feature map in characters, for the terminal (it has no Svg): a box per feature in its layer and a line from each
// feature down to every feature it uses, ending in ▼. A use that skips a row runs down a │ through the rows between.
// Lines that only cross show as ─│─, lines that join as ┬ ┴ ├ ┤. Each line comes back as runs of one tone
// ponytail: a use that closes a loop is left out (loopUses counts them), and no crossing minimisation; fine for a few
// dozen boxes
export function featureMapText(nodes: { name: string; uses: string[]; files?: string[] }[], marks: Record<string, FeatureMark>, width: number) {
  const GAP = 3
  const PAD = width >= 60 ? 2 : 1
  const max = Math.max(1, Math.min(28, width - 2 - 2 * PAD))
  const cut = (n: string) => cutTrim(n, max)
  const note = (n: string) => {
    const k = nodes.find(x => x.name === n)?.files?.length
    return k ? cut(plural(k, 'file')) : ''
  }
  const BH = nodes.some(x => x.files?.length) ? 4 : 3
  const boxW = (n: string) => Math.max(cut(n).length, note(n).length) + 2 + 2 * PAD
  // A layer wider than the pane wraps onto rows of its own
  const rows: string[][] = []
  for (const layer of featureLayers(nodes.map(n => ({ ...n, what: '', files: [], usedBy: [] })))) {
    let row: string[] = []
    let used = 0
    for (const n of layer) {
      if (row.length && used + boxW(n) > width) {
        rows.push(row)
        row = []
        used = 0
      }
      row.push(n)
      used += boxW(n) + GAP
    }
    if (row.length) rows.push(row)
  }
  type Spot = { x: number; w: number; row: number; dummy: boolean }
  const at = new Map<string, Spot>()
  rows.forEach((row, r) => {
    let x = Math.max(0, Math.floor((width - row.reduce((a, n) => a + boxW(n), 0) - GAP * (row.length - 1)) / 2))
    for (const n of row) {
      at.set(n, { x, w: boxW(n), row: r, dummy: false })
      x += boxW(n) + GAP
    }
  })
  const mid = (n: string) => (at.get(n)!.dummy ? at.get(n)!.x : at.get(n)!.x + Math.floor(at.get(n)!.w / 2))
  // The edges as the SVG keeps them: a → c is left out when a reaches c through another feature, unless it is lit
  const uses = new Map([...acyclicUses(nodes)].map(([n, us]) => [n, us.filter(u => at.get(u)!.row > at.get(n)!.row)]))
  const via = (a: string, c: string) => {
    const seen = new Set<string>()
    const walk = (n: string): boolean => (uses.get(n) ?? []).some(m => m === c || (!seen.has(m) && (seen.add(m), walk(m))))
    return (uses.get(a) ?? []).some(b => b !== c && walk(b))
  }
  const edges = nodes
    .flatMap(f => (uses.get(f.name) ?? []).map(u => ({ from: f.name, to: u, lit: marks[f.name] !== undefined && marks[u] !== undefined })))
    .filter(e => e.lit || !via(e.from, e.to))
  // Each edge as hops between neighbouring rows: one that skips rows passes through a stand-in │ in each, shared by
  // the feature's other edges down that way
  const taken = (r: number, c: number) => c < 0 || c >= width || [...at.values()].some(b => b.row === r && (b.dummy ? Math.abs(b.x - c) < 2 : c >= b.x - 1 && c <= b.x + b.w))
  const free = (r: number, c: number) => {
    for (let d = 0; d < width; d++) for (const x of [c - d, c + d]) if (!taken(r, x)) return x
    return c
  }
  const hops = new Map<string, { from: string; to: string; lit: boolean }>()
  const link = (from: string, to: string, lit: boolean) => {
    const h = hops.get(`${from}\0${to}`)
    if (h) h.lit ||= lit
    else hops.set(`${from}\0${to}`, { from, to, lit })
  }
  for (const e of edges) {
    const ra = at.get(e.from)!.row
    const rb = at.get(e.to)!.row
    let prev = e.from
    for (let k = ra + 1; k < rb; k++) {
      const d = `${e.from}\0${k}`
      if (!at.has(d)) at.set(d, { x: free(k, Math.round(mid(e.from) + ((mid(e.to) - mid(e.from)) * (k - ra)) / (rb - ra))), w: 1, row: k, dummy: true })
      link(prev, d, e.lit)
      prev = d
    }
    link(prev, e.to, e.lit)
  }
  // Each channel between two rows: a column for each source's stem and each target's drop, and a lane for each source's horizontal run, sharing lines where the runs don't meet
  const near = (lo: number, hi: number, c: number, avoid: Set<number>) => {
    for (let d = 0; d <= hi - lo; d++) for (const x of [c - d, c + d]) if (x >= lo && x <= hi && !avoid.has(x)) return x
    return c
  }
  const port = (n: string, avoid: Set<number>) => (at.get(n)!.dummy ? at.get(n)!.x : near(at.get(n)!.x + 1, at.get(n)!.x + at.get(n)!.w - 2, mid(n), avoid))
  const chans = rows.slice(0, -1).map((_, r) => {
    const hs = [...hops.values()].filter(h => at.get(h.from)!.row === r)
    const srcs = [...new Set(hs.map(h => h.from))]
    const dsts = [...new Set(hs.map(h => h.to))]
    // A stem and a drop share a column only when they are the same line, a source over the target it uses; a line
    // runs straight where the two boxes overlap
    const inside = (n: string, c: number) => at.get(n)!.dummy ? c === at.get(n)!.x : c > at.get(n)!.x && c < at.get(n)!.x + at.get(n)!.w - 1
    const closest = (n: string, cs: number[]) => cs.filter(c => inside(n, c)).sort((a, b) => Math.abs(a - mid(n)) - Math.abs(b - mid(n)))[0]
    const linked = (a: string, b: string) => hops.has(`${a}\0${b}`)
    const stem = new Map(srcs.map(n => [n, closest(n, dsts.filter(d => linked(n, d)).map(mid)) ?? port(n, new Set(dsts.filter(d => !linked(n, d)).map(mid)))]))
    const drop = new Map(dsts.map(n => [n, closest(n, srcs.filter(x => linked(x, n)).map(x => stem.get(x)!)) ?? port(n, new Set(srcs.filter(x => !linked(x, n)).map(x => stem.get(x)!)))]))
    const span = (n: string) => {
      const xs = [stem.get(n)!, ...hs.filter(h => h.from === n).map(h => drop.get(h.to)!)]
      return [Math.min(...xs), Math.max(...xs)] as const
    }
    const lines: (readonly [number, number])[][] = []
    const lane = new Map<string, number>()
    for (const n of [...srcs].sort((a, b) => span(a)[0] - span(b)[0])) {
      const [lo, hi] = span(n)
      if (lo === hi) continue
      let i = lines.findIndex(l => l.every(([a, b]) => hi < a - 1 || lo > b + 1))
      if (i < 0) i = lines.push([]) - 1
      lines[i]!.push([lo, hi])
      lane.set(n, i)
    }
    return { hs, stem, drop, lane, h: lines.length + 1 }
  })
  // The canvas: boxes and stand-ins are fixed characters; lines are parts, each knowing its hop, so the parts at a
  // cell that share a source or a target join, and the rest only cross
  const tops: number[] = []
  let y = 0
  rows.forEach((_, r) => {
    tops.push(y)
    y += BH + (chans[r]?.h ?? 0)
  })
  const fixed: { ch: string; tone: MapTone }[][] = Array.from({ length: y }, () => [])
  type Part = { bits: number; src: string; dst: string; lit: boolean; arrow: boolean }
  const parts: Part[][][] = Array.from({ length: y }, () => [])
  const [U, D, L, R] = [1, 2, 4, 8]
  const BORDER = { none: '╭╮╰╯─│┬', now: '┏┓┗┛━┃┳', touched: '╭╮╰╯─│┬', reached: '╭╮╰╯┄┆┬' }
  for (const [n, b] of at) {
    const top = tops[b.row]!
    if (b.dummy) {
      const lit = [...hops.values()].some(h => h.to === n && h.lit)
      for (let i = 0; i < BH; i++) fixed[top + i]![b.x] = { ch: '│', tone: lit ? 'lit' : 'line' }
      continue
    }
    const m = marks[n]
    const [tl, tr, bl, br, hz, vt, tee] = [...BORDER[m ?? 'none']] as string[]
    const tone: MapTone = m ?? 'box'
    const stem = chans[b.row]?.stem.get(n)
    for (let i = 0; i < b.w; i++) {
      fixed[top]![b.x + i] = { ch: i === 0 ? tl! : i === b.w - 1 ? tr! : hz!, tone }
      fixed[top + BH - 1]![b.x + i] = { ch: i === 0 ? bl! : i === b.w - 1 ? br! : b.x + i === stem ? tee! : hz!, tone }
    }
    const inner = b.w - 2
    const centred = (x: string) => `${' '.repeat(Math.floor((inner - x.length) / 2))}${x}`.padEnd(inner)
    for (let k = 1; k < BH - 1; k++) {
      fixed[top + k]![b.x] = { ch: vt!, tone }
      fixed[top + k]![b.x + b.w - 1] = { ch: vt!, tone }
      ;[...centred(k === 1 ? cut(n) : note(n))].forEach((ch, i) => (fixed[top + k]![b.x + 1 + i] = { ch, tone: k > 1 ? 'note' : m === 'now' ? 'name-now' : m ? 'name-marked' : 'name' }))
    }
  }
  chans.forEach((c, r) => {
    const y0 = tops[r]! + BH
    const last = c.h - 1
    for (const h of c.hs) {
      const sx = c.stem.get(h.from)!
      const dx = c.drop.get(h.to)!
      const ly = c.lane.get(h.from) ?? last
      // The cells along stem, lane and drop, each with its bits toward the cells before and after it
      const cells: [number, number][] = []
      const go = (x: number, yy: number) => {
        const p = cells[cells.length - 1]
        if (p && p[0] === x && p[1] === yy) return
        if (p) {
          for (let k = p[1] + Math.sign(yy - p[1]); k !== yy; k += Math.sign(yy - p[1])) cells.push([x, k])
          for (let k = p[0] + Math.sign(x - p[0]); k !== x; k += Math.sign(x - p[0])) cells.push([k, yy])
        }
        cells.push([x, yy])
      }
      go(sx, 0)
      go(sx, ly)
      go(dx, ly)
      go(dx, last)
      const toBox = !at.get(h.to)!.dummy
      cells.forEach(([x, yy], i) => {
        let bits = 0
        for (const q of [cells[i - 1], cells[i + 1]]) if (q) bits |= q[1] < yy ? U : q[1] > yy ? D : q[0] < x ? L : R
        if (i === 0) bits |= U
        if (i === cells.length - 1 && !toBox) bits |= D
        ;((parts[y0 + yy]![x] ??= [])).push({ bits, src: h.from, dst: h.to, lit: h.lit, arrow: i === cells.length - 1 && toBox })
      })
    }
  })
  const GLYPH: Record<number, string> = { [U | D]: '│', [U]: '│', [D]: '│', [L | R]: '─', [L]: '─', [R]: '─', [D | R]: '╭', [D | L]: '╮', [U | R]: '╰', [U | L]: '╯', [U | D | R]: '├', [U | D | L]: '┤', [D | L | R]: '┬', [U | L | R]: '┴', [U | D | L | R]: '┼' }
  const cell = (yy: number, x: number): { ch: string; tone: MapTone } => {
    const f = fixed[yy]![x]
    if (f) return f
    const ps = parts[yy]![x]
    if (!ps?.length) return { ch: ' ', tone: 'line' }
    // The parts that join: linked through a shared source or target. Where two groups only cross, the vertical one shows
    const groups: Part[][] = []
    for (const p of ps) {
      const hit = groups.filter(g => g.some(q => q.src === p.src || q.dst === p.dst))
      const merged = [p, ...hit.flat()]
      for (const g of hit) groups.splice(groups.indexOf(g), 1)
      groups.push(merged)
    }
    const g = groups.find(x => x.some(p => p.bits & (U | D))) ?? groups[0]!
    const bits = g.reduce((a, p) => a | p.bits, 0)
    return { ch: g.some(p => p.arrow) ? '▼' : GLYPH[bits] ?? '·', tone: g.some(p => p.lit) ? 'lit' : 'line' }
  }
  return Array.from({ length: y }, (_, yy) => {
    const runs: { text: string; tone: MapTone }[] = []
    for (let x = 0; x < width; x++) {
      const c = cell(yy, x)
      const r = runs[runs.length - 1]
      if (r && (r.tone === c.tone || c.ch === ' ')) r.text += c.ch
      else runs.push({ text: c.ch, tone: c.tone })
    }
    const r = runs[runs.length - 1]
    if (r) r.text = r.text.trimEnd()
    return runs.filter(x => x.text)
  })
}
