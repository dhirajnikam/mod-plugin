import { expect, test } from 'claude-code/testing'
import { parseReport, verifyState, PIPELINES, EXPERTS } from '../hooks/core/experts'

test('parseReport keeps REPORT and HANDOFF, defaults a missing HANDOFF, falls back to the last lines', async () => {
  expect(parseReport('blah\nREPORT: did x\nHANDOFF: run y\n')).toBe('REPORT: did x\nHANDOFF: run y')
  expect(parseReport('REPORT: did x')).toBe('REPORT: did x\nHANDOFF: nothing')
  expect(parseReport('a\nb\nc\nd\ne\nf\ng\nh')).toBe('c\nd\ne\nf\ng\nh')
})

test('verifyState counts pass and fail across the latest Prover and Breaker', async () => {
  const a = (type: string, status: string, cases: { n: string; st: string }[]) => ({ type, status, cases }) as never
  const ok = verifyState([a('cockpit:prover', 'done', [{ n: 'a', st: 'pass' }]), a('cockpit:breaker', 'done', [{ n: 'b', st: 'pass' }])])
  expect([ok.pass, ok.fail, ok.passed, ok.running]).toEqual([2, 0, true, false])
  const bad = verifyState([a('cockpit:prover', 'done', [{ n: 'a', st: 'pass' }]), a('cockpit:breaker', 'done', [{ n: 'b', st: 'fail' }])])
  expect([bad.pass, bad.fail, bad.passed]).toEqual([1, 1, false])
  expect(verifyState([a('cockpit:prover', 'running', [])]).running).toBe(true)
  expect(verifyState([]).passed).toBe(false)
})

// The order a pipeline runs in is driven end to end in breaker.test.tsx
test("every pipeline's steps are registered experts", async () => {
  expect(PIPELINES.length).toBeGreaterThan(0)
  for (const p of PIPELINES) {
    expect(p.steps.length).toBeGreaterThan(0)
    for (const s of p.steps) expect(EXPERTS.map(e => e.type)).toContain(s)
  }
})
