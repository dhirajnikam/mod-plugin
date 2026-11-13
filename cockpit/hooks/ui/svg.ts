import { esc, cutTrim, pushRun } from '../core/text'
import type { TextRun } from '../core/text'
import { THEMES, SVG_TONES, DARK_SURFACE, realColors } from '../core/theme'

// The bit of each dot in a braille cell, by its row and column
const DOT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]
// The progress ring in braille characters, for the terminal: each cell holds 2×4 dots, the percentage sits across the
// middle row, and each row comes back as runs of one colour
export function ringRuns(pct: number, fill: string, track: string, ink: string, cols = 14): TextRun[][] {
  const rows = Math.ceil(cols / 2)
  const w = cols * 2
  const h = rows * 4
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const r1 = Math.min(w, h) / 2 - 0.4
  const r0 = r1 - 3.2
  const label = `${pct}%`
  const mid = Math.floor(rows / 2)
  const start = Math.floor((cols - label.length) / 2)
  return Array.from({ length: rows }, (_, row) => {
    const runs: TextRun[] = []
    for (let col = 0; col < cols; col++) {
      let bits = 0
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const d = Math.hypot(col * 2 + dx - cx, row * 4 + dy - cy)
          if (d <= r1 && d >= r0) bits |= DOT[dy]![dx]!
        }
      const ch = row === mid ? label[col - start] : undefined
      const a = (Math.atan2(col * 2 + 0.5 - cx, -(row * 4 + 1.5 - cy)) / (2 * Math.PI) + 1) % 1
      const cell: TextRun = ch ? { t: ch, fg: ink } : bits ? { t: String.fromCharCode(0x2800 + bits), fg: pct > 0 && a <= pct / 100 ? fill : track } : { t: ' ' }
      pushRun(runs, cell)
    }
    return runs
  })
}
// The design's SVG progress ring, for surfaces that draw SVG (desktop, the editor, mobile)
export function ringSvg(pct: number, c: { accent: string; track: string; text: string; dim: string }) {
  const off = (314.16 * (1 - pct / 100)).toFixed(1)
  // The percentage falls back to the accent as it was handed in
  c = realColors(c, { ...SVG_TONES, track: 'rgba(128,128,128,0.28)', text: c.accent })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">` +
    `<circle cx="60" cy="60" r="50" fill="none" stroke="${c.track}" stroke-width="8"/>` +
    `<circle cx="60" cy="60" r="50" fill="none" stroke="${c.accent}" stroke-width="8" stroke-linecap="round" stroke-dasharray="314.16" stroke-dashoffset="${off}" transform="rotate(-90 60 60)"/>` +
    `<text x="60" y="62" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="${c.text}">${pct}%</text>` +
    `<text x="60" y="82" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="${c.dim}"></text></svg>`
}
// The neural view for surfaces that draw SVG: the task in the middle; above it the agents at work on it, each a neuron
// joined to the task by a line a signal runs along while it works, its ring filling with its task list; below, the
// runs remembered from similar tasks, faint, each joined to the agent of its kind at work now (else to the task); a
// tester joined to the agent whose work it tests. Hovering a neuron says what it is doing or found
export type Neuron = { id: string; name: string; line: string; state: 'running' | 'done' | 'failed' | 'memory'; pct?: number; link?: string }
export function neuralSvg(task: string, ns: Neuron[], c: { accent: string; busy: string; ok: string; bad: string; text: string; dim: string; track: string; bg: string }, width = 560) {
  c = realColors(c, { ...SVG_TONES, ok: THEMES.black.ok, bad: THEMES.black.bad, bg: DARK_SURFACE })
  const live = ns.filter(n => n.state !== 'memory').slice(0, 6)
  const mem = ns.filter(n => n.state === 'memory').slice(0, 3)
  const cx = width / 2
  const cy = 0
  // Wide ellipses, so a neuron's label (about 170px) clears the task in the middle
  const RX = Math.max(120, Math.min(width / 2 - 85, 210))
  const RY = 100
  const at = new Map<string, { x: number; y: number }>()
  // Above the task on one arc for the agents at work, below it on another for what is remembered
  const place = (row: Neuron[], from: number, span: number, k: number) =>
    row.forEach((n, i) => {
      const deg = row.length === 1 ? from + span / 2 : from + (span * i) / (row.length - 1)
      const rad = (deg * Math.PI) / 180
      at.set(n.id, { x: cx + RX * k * Math.cos(rad), y: cy + RY * k * Math.sin(rad) })
    })
  place(live, 200, 140, 1)
  place(mem, 40, 100, 0.85)
  // A neuron's labels sit on the side its lines do not come from: above it when every neuron it is joined to (the
  // task, the agent it tests, a tester of its work) is below, else below it. So no line runs through its words
  const ends = (n: Neuron) => {
    const own = n.link && at.has(n.link) ? at.get(n.link)! : { x: cx, y: cy }
    return [own, ...[...live, ...mem].filter(x => x.link === n.id).map(x => at.get(x.id)!)]
  }
  const up = new Map([...live, ...mem].map(n => [n.id, ends(n).every(e => e.y > at.get(n.id)!.y)]))
  // Trimmed to what is drawn: the highest label to the lowest
  const ys = [cy - 42, cy + 52, ...[...at.entries()].flatMap(([id, p]) => (up.get(id) ? [p.y - 52, p.y + 22] : [p.y - 22, p.y + 52]))]
  const top = Math.min(...ys) - 6
  const height = Math.round(Math.max(...ys) - top + 6)
  const col = (n: Neuron) => (n.state === 'running' ? c.busy : n.state === 'done' ? c.ok : n.state === 'failed' ? c.bad : c.dim)
  const curve = (a0: { x: number; y: number }, b0: { x: number; y: number }, ra = 0, rb = 0, bend = 0.18) => {
    // From rim to rim: each end stops at its circle's edge
    const len = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1
    const ux = (b0.x - a0.x) / len
    const uy = (b0.y - a0.y) / len
    const a = { x: a0.x + ux * ra, y: a0.y + uy * ra }
    const b = { x: b0.x - ux * rb, y: b0.y - uy * rb }
    const mx = (a.x + b.x) / 2 + (b.y - a.y) * bend
    const my = (a.y + b.y) / 2 - (b.x - a.x) * bend
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
  }
  const centre = { x: cx, y: cy }
  const lines = [...live, ...mem].map(n => {
    const p = at.get(n.id)!
    const linked = !!n.link && at.has(n.link)
    const to = linked ? at.get(n.link!)! : centre
    const rim = (x: Neuron | undefined) => (x?.state === 'running' && x.pct !== undefined ? 22 : 16)
    const d = curve(to, p, linked ? rim(live.find(x => x.id === n.link)) : 42, rim(n))
    if (n.state === 'running') return `<path d="${d}" fill="none" stroke="${c.busy}" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round"><animate attributeName="stroke-dashoffset" values="20;0" dur="0.9s" repeatCount="indefinite"/></path>`
    if (n.state === 'memory') return `<path d="${d}" fill="none" stroke="${c.dim}" stroke-width="1.2" stroke-dasharray="2 5" opacity="0.7"/>`
    return `<path d="${d}" fill="none" stroke="${col(n)}" stroke-width="1.5" opacity="0.65"/>`
  })
  const nodes = [...live, ...mem].map(n => {
    const p = at.get(n.id)!
    const k = col(n)
    const ring = n.state === 'running' && n.pct !== undefined ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="20" fill="none" stroke="${c.busy}" stroke-width="2.5" stroke-dasharray="${(125.7 * n.pct).toFixed(1)} 125.7" transform="rotate(-90 ${p.x.toFixed(1)} ${p.y.toFixed(1)})"/>` : ''
    const pulse = n.state === 'running' ? `<animate attributeName="r" values="14;16.5;14" dur="1.6s" repeatCount="indefinite"/>` : ''
    return `<g opacity="${n.state === 'memory' ? 0.75 : 1}"><title>${esc(`${n.name}\n${n.line}`)}</title>` +
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="14" fill="${c.bg}" stroke="${k}" stroke-width="2"${n.state === 'memory' ? ' stroke-dasharray="3 3"' : ''}>${pulse}</circle>${ring}` +
      `<text x="${p.x.toFixed(1)}" y="${(p.y + 4.5).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="${k}">${esc(n.name.replace(/^\W+/, '').slice(0, 1).toUpperCase())}</text>` +
      `<text x="${p.x.toFixed(1)}" y="${(p.y + (up.get(n.id) ? -40 : 34)).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="${n.state === 'memory' ? c.dim : c.text}">${esc(cutTrim(n.name, 18))}</text>` +
      `<text x="${p.x.toFixed(1)}" y="${(p.y + (up.get(n.id) ? -26 : 48)).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10.5" fill="${c.dim}">${esc(cutTrim(n.line, 28))}</text></g>`
  })
  // The task: two lines of it inside the core
  const t1 = cutTrim(task || 'No task yet', 34)
  const split = t1.length > 17 ? t1.lastIndexOf(' ', 17) : -1
  const [a1, a2] = split > 0 ? [t1.slice(0, split), t1.slice(split + 1)] : [t1, '']
  const core = `<g><title>${esc(task)}</title><circle cx="${cx}" cy="${cy}" r="40" fill="${c.bg}" stroke="${c.accent}" stroke-width="2.5"/>` +
    `<text x="${cx}" y="${cy + (a2 ? -3 : 4)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${c.text}">${esc(a1)}</text>` +
    (a2 ? `<text x="${cx}" y="${cy + 11}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${c.text}">${esc(cutTrim(a2, 17))}</text>` : '') + `</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${top.toFixed(0)} ${width} ${height}" width="${width}" height="${height}">${lines.join('')}${core}${nodes.join('')}</svg>`
}
