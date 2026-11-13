import { expect, test } from 'claude-code/testing'
import { pickRun, pickLabel } from '../hooks/agents/pick'

// Pins the table docs/agents.md documents: a changed default is a product change, and belongs in both
test('the kind sets the start: thinking work stronger, docs lighter', async () => {
  expect(pickRun('add a limiter', 'cockpit:builder')).toMatchObject({ model: 'sonnet', effort: 'medium', agents: 1, why: 'a usual task' })
  expect(pickRun('add a limiter', 'cockpit:planner')).toMatchObject({ model: 'opus', effort: 'high', why: 'planning needs depth' })
  expect(pickRun('add a limiter', 'cockpit:reviewer').model).toBe('opus')
  expect(pickRun('add a limiter', 'cockpit:scribe')).toMatchObject({ model: 'haiku', effort: 'low', why: 'writing docs' })
  expect(pickRun('add a limiter', 'Explore')).toMatchObject({ model: 'sonnet', effort: 'medium' })
})

test('light words step down, strong words step up, and say which', async () => {
  const light = pickRun('fix a typo in the docs', 'cockpit:builder')
  expect([light.model, light.effort, light.why]).toEqual(['haiku', 'low', 'light work (typo, docs)'])
  expect(pickLabel(light)).toBe('haiku · low — light work (typo, docs)')
  const hard = pickRun('debug a race in the cache', 'cockpit:builder')
  expect([hard.model, hard.effort, hard.why]).toEqual(['opus', 'high', 'hard work (debug, race)'])
  // Mixed signals cancel
  expect(pickRun('refactor the docs', 'cockpit:builder')).toMatchObject({ model: 'sonnet', effort: 'medium' })
})

test('a long brief and many files step up; the ladder has ends', async () => {
  expect(pickRun('x'.repeat(700), 'cockpit:builder')).toMatchObject({ effort: 'high', why: 'long brief' })
  const big = pickRun('add a limiter', 'cockpit:builder', 9)
  expect([big.effort, big.why]).toEqual(['high', '9 files'])
  const top = pickRun('refactor the security architecture ' + 'x'.repeat(700), 'cockpit:planner', 20)
  expect([top.model, top.effort]).toEqual(['opus', 'xhigh'])
  expect(top.agents).toBe(1)
  expect(pickRun('rename the readme typo', 'cockpit:scribe').model).toBe('haiku')
  // A big, hard build is the one case that asks for a second builder
  expect(pickRun('refactor the auth code', 'cockpit:builder', 10).agents).toBe(2)
})
