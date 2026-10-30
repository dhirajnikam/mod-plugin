import { expect, test } from 'claude-code/testing'
import { THEMES } from '../hooks/theme'

// WCAG contrast of two #rrggbb colours
const lum = (hex: string) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

// Each palette paints its own background, so its text, accent and status colours must read on it
test('every palette\'s text, accent and status colours read on its own background', async () => {
  for (const [name, t] of Object.entries(THEMES)) {
    for (const [role, c] of Object.entries({ text: t.text, accent: t.accent, ok: t.ok, bad: t.bad, busy: t.busy })) {
      const r = contrast(c, t.bg)
      if (r < 3) throw new Error(`${name} ${role} ${c} on ${t.bg}: ${r.toFixed(2)}`)
      expect(r >= 3).toBe(true)
    }
  }
})
