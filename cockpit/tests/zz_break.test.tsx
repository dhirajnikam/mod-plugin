import { expect, test } from 'claude-code/testing'
import { parseOptions } from '../hooks/ops/decisions'
const L = (t: string) => parseOptions(t).map(x => x.label)
test('numbered', () => { expect(L('1. PRODUCT: OPTION a\n2. PRODUCT: OPTION b')).toEqual(['a', 'b']) })
test('backtick', () => { expect(L('`PRODUCT: OPTION a :: x`\nPRODUCT: OPTION b')).toEqual(['a', 'b']) })
test('echo template', () => { expect(L('PRODUCT: OPTION <the goal> :: <why>\nPRODUCT: OPTION b')).toEqual(['b']) })
test('empty/huge', () => { expect(L('')).toEqual([]); expect(L('PRODUCT: OPTION x\n'.repeat(100000)).length).toBe(1) })
test('proto', () => { expect(L('PRODUCT: OPTION __proto__\nPRODUCT: OPTION b')).toEqual(['__proto__', 'b']) })
test('long prefix dup', () => { const p = 'a'.repeat(250); expect(L(`PRODUCT: OPTION ${p}1\nPRODUCT: OPTION ${p}2`).length).toBe(1) })
test('nbsp/unicode case', () => { expect(L('PRODUCT: OPTION a b\nPRODUCT: OPTION A b')).toEqual(['a b']) })
test('inline mid-line', () => { expect(L('Here: PRODUCT: OPTION a\nPRODUCT: OPTION b')).toEqual(['b']) })
test('fullwidth colon / lowercase', () => { expect(L('product: option a\nproduct: option b')).toEqual(['a', 'b']) })
