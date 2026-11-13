import type { GitForm, PrStatus } from '../../types'
import { slug, plain, workOf } from '../core/text'
import { isTestFeature } from '../memory/memory'

export const TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'chore']
export const BRANCH_PRESETS = [
  { v: '{kind}/{slug}', label: 'feature/add-login' },
  { v: '{kind}/{ticket}-{slug}', label: 'feature/API-12-add-login' },
  { v: '{user}/{kind}-{slug}', label: 'dev/feature-add-login' },
  { v: '{slug}', label: 'add-login' },
]
export const MSG_PRESETS = [
  { v: '{type}: {subject}', label: 'Conventional' },
  { v: '{ticket} {type}: {subject}', label: 'Ticket first' },
  { v: '{Subject}', label: 'Plain sentence' },
]
export const AUTO_WHENS: { v: GitForm['autoWhen']; label: string }[] = [
  { v: 'step', label: 'after each turn that changes files' },
  { v: 'tests', label: 'after the Verify experts pass' },
]
export const COMMIT_MODES: [GitForm['commitMode'], string, string][] = [
  ['auto', 'Auto-commit', 'Cockpit commits by itself, type and branch chosen for you'],
  ['ask', 'Ask me', 'Cockpit proposes each commit; you press Commit or Skip'],
  ['manual', 'Manual', 'Only when you press Commit'],
]
// Branches that work is cut from, never committed to directly when a branch pattern is set
export const BASE_BRANCHES = ['main', 'master', 'develop', 'trunk']
// The commit type a change calls for, from the words of the task and the files it touched
export function inferType(task: string, paths: string[]) {
  const named = workOf(task)
  if (named) return named
  if (task) return 'feat'
  if (paths.length && paths.every(p => /\.(md|txt|rst)$/i.test(p))) return 'docs'
  // The memory map's rule for a test file (a tests folder or a .test./.spec. name), not any path holding the letters
  if (isTestFeature({ files: paths })) return 'test'
  return paths.length ? 'feat' : 'chore'
}
const kindOf = (type: string) => (type === 'feat' ? 'feature' : type)
export const GIT_OPTS: [keyof GitForm, string][] = [
  ['branchAuto', 'New branch off the base, by the pattern'],
  ['breaking', 'Breaking change'],
  ['preTest', 'Only after the Verify experts pass'],
  ['push', 'Push after commit'],
  ['pr', 'Open pull request'],
  ['draft', 'PR as draft'],
  ['signoff', 'Sign-off'],
  ['gpg', 'GPG sign'],
]
export const branchName = (g: GitForm, current: string) => {
  if (g.branch) return g.branch
  // A pattern applies when the work sits on a base branch; a branch already cut keeps its name
  if (!g.branchAuto || !BASE_BRANCHES.includes(current) && current !== g.base) return current
  return g.branchPattern
    .replace(/\{kind\}/g, kindOf(g.type))
    .replace(/\{type\}/g, g.type)
    .replace(/\{ticket\}/g, slug(g.ticket))
    .replace(/\{slug\}/g, slug(g.subject))
    .replace(/\{user\}/g, slug(g.user))
    .replace(/\{scope\}/g, slug(g.scope))
    // Empty fields leave no stray dashes or slashes
    .replace(/-{2,}/g, '-')
    .replace(/(^|\/)-+|-+(?=\/|$)/g, '$1')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/|\/$/g, '')
}
export const commitMsg = (g: GitForm, branch: string) => {
  let m = g.msgPattern
    .replace(/\{type\}/g, g.type)
    .replace(/\(\{scope\}\)/g, () => (g.scope ? `(${g.scope})` : ''))
    .replace(/\{scope\}/g, () => g.scope)
    .replace(/\{subject\}/g, () => g.subject)
    .replace(/\{Subject\}/g, () => g.subject.charAt(0).toUpperCase() + g.subject.slice(1))
    .replace(/\{ticket\}/g, () => g.ticket)
    .replace(/\{branch\}/g, () => branch)
  if (g.breaking) {
    const i = m.indexOf(': ')
    m = i > 0 ? `${m.slice(0, i)}!${m.slice(i)}` : `BREAKING: ${m}`
  }
  return m
}
// A commit a model wrote from the diff: {"type", "subject"}; a type it made up or an empty subject is no answer
export function parseCommit(text: string): { type: string; subject: string } | null {
  try {
    const o = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { type?: unknown; subject?: unknown }
    const type = String(o.type ?? '').trim().toLowerCase()
    const subject = String(o.subject ?? '').trim().split('\n')[0]!.replace(/[.!]+$/, '').slice(0, 72)
    return TYPES.includes(type) && subject ? { type, subject: subject.charAt(0).toLowerCase() + subject.slice(1) } : null
  } catch {
    return null
  }
}
// The current branch's pull request from gh's JSON: `gh pr view --json number,title,url,state,isDraft,reviewDecision`
// and `gh pr checks --json name,bucket,link`. No PR, or output gh did not write, is null; checks that cannot be read
// (cut off, gh failed) are unknown, never "none", so a failing check is not hidden behind "no checks"
export function parsePr(view: string, checks: string): PrStatus | null {
  const json = (t: string) => { try { return JSON.parse(t) } catch { return null } }
  const v = json(view)
  if (!v || typeof v !== 'object' || typeof v.number !== 'number') return null
  const REVIEW = new Map([['APPROVED', 'approved'], ['CHANGES_REQUESTED', 'changes'], ['REVIEW_REQUIRED', 'required']] as const)
  const review = v.isDraft ? 'draft' : (REVIEW.get(v.reviewDecision) ?? '')
  const list = json(checks)
  const c = { pass: 0, fail: 0, pending: 0, skip: 0, failing: [] as { name: string; link: string }[], ...(Array.isArray(list) ? {} : { unknown: true }) }
  for (const k of Array.isArray(list) ? list : []) {
    // gh's buckets: pass, fail, pending, skipping, cancel (a cancelled run did not pass, so it counts as failed)
    const b = String(k?.bucket ?? '').toLowerCase()
    if (b === 'pass') c.pass++
    else if (b === 'pending') c.pending++
    else if (b === 'skipping') c.skip++
    else if (b === 'fail' || b === 'cancel') {
      c.fail++
      c.failing.push({ name: plain(k?.name ?? '?'), link: plain(k?.link) })
    }
  }
  return { number: v.number, title: plain(v.title), url: plain(v.url), state: (['OPEN', 'CLOSED', 'MERGED'].includes(v.state) ? v.state : 'OPEN'), review, checks: c }
}
// The key a finished run's notice is told under, once: the PR, which of its runs, and how it ended. Nothing in it
// changes between two reads of the same finished run
export const ciKey = (branch: string, number: number, run: number, passed: boolean) => `ci:${branch}#${number}:${run}:${passed ? 'passed' : 'failed'}`
// The base branch: the one you picked, else the repository's (origin's HEAD, else the first of BASE_BRANCHES it has), else none. A
// saved base that is only the branch you are on, with no real base around, is what an earlier version guessed; it is
// let go, or that branch's pull request would never be read
export function baseFor(saved: string, current: string, detected: string) {
  return saved && !(saved === current && !detected) ? saved : detected
}
