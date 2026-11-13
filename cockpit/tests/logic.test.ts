import { expect, test } from 'claude-code/testing'

import type { GitForm } from '../types'
import { branchName, inferType, parseCommit, commitMsg, parsePr, baseFor } from '../hooks/git/git-form'
import { nJ, thrOf, tally } from '../hooks/judges/judges'
import { flowOf, progressOf, parseSteps, applyPlan } from '../hooks/flows/flows'
import { stepOf, stepWords } from '../hooks/flows/tools'
import { parseCases } from '../hooks/agents/experts'
import { tree } from '../hooks/memory/tree'
import { themeOf, chatThemeOf } from '../hooks/core/theme'

// Branch and commit patterns, flows and progress, step and plan parsing, judges' thresholds, the file tree and the
// pull request reader: each row is an input and what it must give, edge cases first
test('patterns, flows, steps, judges and the pull request reader give what they should', async () => {
  const g = { branch: '', branchAuto: true, branchPattern: '{type}/{ticket}-{slug}', ticket: 'API-142', user: 'dev', base: 'main', type: 'feat', scope: 'auth', subject: 'add rate limiting to login', body: '', msgPattern: '{type}({scope}): {subject}', commitMode: 'ask', autoWhen: 'step', setupDone: true, breaking: false, push: false, pr: false, draft: false, signoff: false, gpg: false, preTest: false } as GitForm
  const checks: [unknown, unknown][] = [
    [branchName(g, 'main'), 'feat/api-142-add-rate-limiting-to-login'],
    [branchName({ ...g, branchPattern: '{kind}/{slug}' }, 'main'), 'feature/add-rate-limiting-to-login'],
    [branchName({ ...g, type: 'fix', branchPattern: '{kind}/{slug}' }, 'master'), 'fix/add-rate-limiting-to-login'],
    [branchName(g, 'feature/old'), 'feature/old'],
    [branchName({ ...g, ticket: '' }, 'main'), 'feat/add-rate-limiting-to-login'],
    [branchName({ ...g, ticket: '', subject: '' }, 'main'), 'feat'],
    [inferType('fix the login bug', []), 'fix'],
    [inferType('add a settings page', []), 'feat'],
    [inferType('', ['README.md']), 'docs'],
    [inferType('', []), 'chore'],
    [JSON.stringify(parseCommit('```json\n{"type": "fix", "subject": "Handle an empty token."}\n```')), '{"type":"fix","subject":"handle an empty token"}'],
    [parseCommit('{"type": "wip", "subject": "x"}'), null],
    [commitMsg(g, 'x'), 'feat(auth): add rate limiting to login'],
    [commitMsg({ ...g, breaking: true }, 'x'), 'feat(auth)!: add rate limiting to login'],
    [nJ(2), 3], [nJ(5), 6], [nJ(8), 9], [thrOf(6), 4],
    [flowOf('what does this hook do?').name, 'answer'],
    [flowOf('add a settings page').name, 'build'],
    [flowOf('update the readme').name, 'docs'],
    [flowOf('make sure it works').name, 'check'],
    [flowOf('what is x', ['Understand', 'Explore', 'Implement']).name, 'build'],
    [flowOf('what is x', ['Understand', 'Explore', 'Implement'], 'answer').name, 'answer'],
    [progressOf('why?', ['Understand', 'Explore', 'Answer'], false).pct, 100],
    // Implement reached with Explore skipped: Explore is skipped, not done, and left out of the count
    [progressOf('add x', ['Understand', 'Implement'], true).steps.map(x => x.st).join(), 'done,skipped,active,pending,pending'],
    [progressOf('add x', ['Understand', 'Implement'], true).pct, 38],
    [stepOf('Bash', { command: "python3 - <<'EOF'\nprint(1)\nEOF" }), 'Implement'],
    [stepOf('Bash', { command: 'grep -n foo hooks/x.ts | head' }), 'Explore'],
    [stepOf('Bash', { command: 'npx tsc -p . && claude plugin test .' }), 'Verify'],
    [progressOf('x', ['Understand', 'Explore', 'Implement'], true, undefined, [], [{ name: 'Read the hooks', kind: 'Explore' }, { name: 'Fix the path', kind: 'Implement' }, { name: 'TextRun the tests', kind: 'Verify' }, { name: 'Commit', kind: 'Commit' }]).pct, 38],
    [parseSteps('ok: [{"step":"Read the hooks","kind":"Explore"},{"step":"x","kind":"Nope"},{"step":"Fix it","kind":"implement"}]').map(x => x.kind).join(), 'Explore,Implement'],
    [progressOf('x', [], true, undefined, [{ id: 'a', text: 'a', st: 'completed' }, { id: 'b', text: 'b', st: 'in_progress' }, { id: 'c', text: 'c', st: 'pending' }, { id: 'd', text: 'd', st: 'pending' }]).pct, 38],
    [applyPlan([], 'TaskUpdate', { taskId: '2', status: 'completed' }, {}, [[{ id: '2', text: 'old', st: 'pending' }]]).map(p => p.st).join(), 'completed'],
    [applyPlan([{ id: 'a', text: 'a', st: 'in_progress' }, { id: 'b', text: 'b', st: 'pending' }], 'mcp__ccd_turn__update_plan', { advance: true }, {}).map(p => p.st).join(), 'completed,in_progress'],
    [applyPlan([{ id: 'a', text: 'a', st: 'pending' }, { id: 'b', text: 'b', st: 'pending' }, { id: 'c', text: 'c', st: 'pending' }], 'mcp__ccd_turn__update_plan', { done: [1], start: 3 }, {}).map(p => p.st).join(), 'completed,pending,in_progress'],
    [progressOf('add x', ['Understand', 'Explore', 'Decide', 'Implement'], true).steps.map(x => x.name).join(), 'Understand,Explore,Decide,Implement,Verify,Commit'],
    [parseCases('CASE PASS works\nCASE FAIL bad :: got 200').map(c => c.st).join(), 'pass,fail'],
    [tally({ id: 'd', q: '', opts: ['a', 'b'], at: 0, score: 5, signals: [], votes: [0, 0, 0, 0, 1, -1], status: 'voting', result: '' }).passes, true],
    // $ in a subject is text, not a replacement pattern; a ticket with a space still makes a valid branch
    [commitMsg({ ...g, subject: "show $' price" }, 'x'), "feat(auth): show $' price"],
    [branchName({ ...g, ticket: 'API 12' }, 'main'), 'feat/api-12-add-rate-limiting-to-login'],
    [branchName({ ...g, ticket: '', subject: 'ログインを追加' }, 'main'), 'feat/ログインを追加'],
    // A test run is a whole word: latest and tests/ are not one, and a commit whose message names a test is a commit
    [stepOf('Bash', { command: 'npm i x@latest' }), ''],
    [stepOf('Bash', { command: 'cat tests/a.ts' }), 'Explore'],
    [stepOf('Bash', { command: 'git commit -m "fix flaky test"' }), 'Commit'],
    [stepOf('Bash', { command: 'python -m unittest' }), 'Verify'],
    [stepOf('Bash', { command: 'make tests' }), 'Verify'],
    [stepWords('Bash cd /Users/x/cockpit && claude plugin test .'), 'Running the tests'],
    [stepWords('Edit /Users/x/cockpit/hooks/views.tsx'), 'Editing views.tsx'],
    [stepWords('Bash cd /a && git status --short'), 'Running git status --short'],
    [inferType('add a specific field', []), 'feat'],
    [inferType('make it perfect', []), 'feat'],
    [parseSteps('Here [see below]: [{"step":"a","kind":"Explore"}]').length, 1],
    // The root is stripped only as a prefix: a relative path keeps its slashes before the root is known
    [tree([{ id: '1', op: 'Edit', path: 'src/a.ts', at: 0, meta: '', add: 0, del: 0, lines: [] }], {}, '').map(r => r.path).join(), 'src,src/a.ts'],
    [tree([{ id: '1', op: 'Edit', path: 'C:\\r\\src\\a.ts', at: 0, meta: '', add: 0, del: 0, lines: [] }], {}, 'C:\\r').map(r => r.path).join(), 'src,src/a.ts'],
    // A theme id the store kept from elsewhere draws as Auto instead of throwing
    [themeOf({ theme: 'gone' as never }).accent, '#b4833a'],
    [chatThemeOf({ theme: 'gone' as never }).accent, '#b4833a'],
    // The branch's PR: a failing and a cancelled check named, a pending one counted; draft wins over the review
    [JSON.stringify(parsePr('{"number":7,"title":"Add x","url":"u","state":"OPEN","isDraft":false,"reviewDecision":"CHANGES_REQUESTED"}', '[{"name":"test","bucket":"fail","link":"l1"},{"name":"lint","bucket":"pass"},{"name":"e2e","bucket":"pending"},{"name":"deploy","bucket":"cancel","link":"l2"},{"name":"docs","bucket":"skipping"}]')), '{"number":7,"title":"Add x","url":"u","state":"OPEN","review":"changes","checks":{"pass":1,"fail":2,"pending":1,"skip":1,"failing":[{"name":"test","link":"l1"},{"name":"deploy","link":"l2"}]}}'],
    [parsePr('{"number":7,"isDraft":true,"reviewDecision":"APPROVED"}', '[{"bucket":"pass"}]')?.review, 'draft'],
    [parsePr('{"number":7,"reviewDecision":"APPROVED"}', '[{"bucket":"pass"},{"bucket":"pass"}]')?.checks.pass, 2],
    [parsePr('{"number":7,"reviewDecision":""}', '[]')?.checks.unknown, undefined],
    [parsePr('{"number":7,"reviewDecision":""}', '[{"name":"a","bucket":"fail"},{"na')?.checks.unknown, true],
    [parsePr('{"number":7}', '[{"name":"a","bucket":"FAIL"}]')?.checks.fail, 1],
    [parsePr('no pull requests found for branch "x"', ''), null],
    [parsePr('{"title":"no number"}', '[]'), null],
    [parsePr('null', '[]'), null],
    [baseFor('', 'feat/x', 'main'), 'main'],
    [baseFor('develop', 'feat/x', 'main'), 'develop'],
    [baseFor('feat/x', 'feat/x', ''), ''],
    [baseFor('main', 'main', 'main'), 'main'],
    [baseFor('', 'feat/x', ''), ''],
    [parsePr('{"number":7,"title":"a\\u001b[31mb\\nc"}', '[{"name":"t\\u0007","bucket":"fail"}]')?.title + '|' + parsePr('{"number":7}', '[{"name":"t\\u0007","bucket":"fail"}]')?.checks.failing[0]?.name, 'a [31mb c|t '],
  ]
  expect(checks.map(([got]) => got)).toEqual(checks.map(([, want]) => want))
})

