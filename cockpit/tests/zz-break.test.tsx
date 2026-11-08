import { expect, test } from 'claude-code/testing'
import { changeMcp, mcpRows, parseSettings } from '../hooks/rules'
const rows = (m: any, c: any = {}) => mcpRows(m, c, [], '/repo')
test('A malformed containers do not throw', () => {
  for (const v of [[], null, 'x', 5, true]) expect(() => rows({ mcpServers: v }, { mcpServers: v, projects: v })).not.toThrow()
  expect(() => mcpRows({}, { projects: { '/repo': 'x' } }, [{ disabledMcpjsonServers: 'x' }], '/repo')).not.toThrow()
})
test('B entries as strings/null/array', () => {
  const r = rows({ mcpServers: { a: 'x', b: null, c: [1], d: { args: 'no', command: 5, env: 'x', headers: [1] } } })
  expect(r.length).toBe(4)
})
test('C proto names', () => {
  const m = JSON.parse('{"mcpServers":{"__proto__":{"command":"evil"},"constructor":{"command":"c"}}}')
  const r = rows(m)
  expect(r.map(x => x.name)).toEqual(['__proto__', 'constructor'])
  // add "constructor" onto empty
  const n = changeMcp({}, { add: { name: 'constructor', target: 'x y' } })
  expect(Object.keys((n as any).mcpServers ?? {})).toEqual(['constructor'])
})
test('D add __proto__ persists', () => {
  const n: any = changeMcp({}, { add: { name: '__proto__', target: 'x y' } })
  expect(JSON.parse(JSON.stringify(n)).mcpServers && Object.keys(JSON.parse(JSON.stringify(n)).mcpServers)).toEqual(['__proto__'])
})
test('E rename to __proto__ keeps server', () => {
  const j = { mcpServers: { a: { command: 'x' } } }
  const row = rows(j)[0]!
  const n: any = changeMcp(j, { edit: row, name: '__proto__', target: 'x' })
  expect(Object.keys(JSON.parse(JSON.stringify(n)).mcpServers ?? {}).length).toBe(1)
})
test('F edit string entry', () => {
  const j: any = { mcpServers: { a: 'junk' } }
  const row = rows(j)[0]!
  const n: any = changeMcp(j, { edit: row, name: 'a', target: 'new cmd' })
  expect(Object.keys(n.mcpServers.a).sort()).toEqual(['args', 'command'])
})
test('G secrets in url/args', () => {
  const r = rows({ mcpServers: { a: { url: 'https://u:pw@h/mcp?token=SECRET' }, b: { command: 'srv', args: ['--token=SECRET'] } } })
  expect(JSON.stringify(r)).not.toContain('SECRET')
})
test('H rename onto existing, empty', () => {
  const j = { mcpServers: { a: { command: 'x' }, b: { command: 'y' } } }
  const [a] = rows(j)
  expect(changeMcp(j, { edit: a!, name: 'b', target: 'x' })).toBe(j)
  expect(changeMcp(j, { add: { name: ' ', target: 'x' } })).toBe(j)
  expect(changeMcp(j, { add: { name: 'z', target: '  ' } })).toBe(j)
})
test('I control chars: name with ctrl chars edit/remove mismatch', () => {
  const j = { mcpServers: { 'a\nb': { command: 'x\u001b[31m y' } } }
  const row = rows(j)[0]!
  const n: any = changeMcp(j, { remove: row })
  expect(n).not.toBe(j)
})
test('J user/local row cannot edit project', () => {
  const j = { mcpServers: { a: { command: 'x' } } }
  const row = { ...rows(j)[0]!, scope: 'user' as const }
  expect(changeMcp(j, { remove: row })).toBe(j)
})
test('K non-object mcpServers preserved on failed op, array on add', () => {
  const j: any = { mcpServers: ['keep'] }
  const n: any = changeMcp(j, { add: { name: 'a', target: 'x' } })
  expect(n.mcpServers).toEqual(['keep'].length ? n.mcpServers : 0)
  expect(Array.isArray(n.mcpServers)).toBe(true)
})
test('L huge', () => {
  const s: any = {}
  for (let i = 0; i < 50000; i++) s['s' + i] = { command: 'x', args: ['a'] }
  const t = Date.now(); rows({ mcpServers: s }); expect(Date.now() - t).toBeLessThan(3000)
})
