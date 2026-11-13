import type { $ } from '../core/core'
import { look, toast, set } from '../core/core'
import { tellDone } from '../core/notify'
import { repoRoot } from '../core/repos'
import { gh } from './accounts'
import { parsePr, ciKey } from './git-form'

// Fix failing checks: Claude is handed each failing check's name and the end of its failed steps' log (GitHub Actions
// only; another CI's check goes with its link), and asked to find the cause and fix it
export async function fixChecks($: $) {
  const pr = (await look($)).repo.pr
  if (!pr?.checks.failing.length) return toast($, 'No failing checks to fix')
  const parts: string[] = []
  // ponytail: three checks, the last 120 lines and 6k characters of each log; enough to name the error, not to read it all
  for (const f of pr.checks.failing.slice(0, 3)) {
    const run = f.link.match(/\/actions\/runs\/(\d+)/)?.[1]
    const log = run ? await gh($, ['run', 'view', run, '--log-failed'], undefined, (await repoRoot($)) || undefined) : null
    const tail = log?.exitCode === 0 ? log.stdout.trim().split('\n').slice(-120).join('\n').slice(-6000) : ''
    parts.push(tail ? `${f.name}, the end of its failed steps:\n\`\`\`\n${tail}\n\`\`\`` : `${f.name}${f.link ? ` (${f.link})` : ''}: no log could be read`)
  }
  // privacy: none; the log goes into your own conversation, as a prompt you could have pasted (docs/privacy.md)
  const text = `Fix the failing CI checks on pull request #${pr.number} (${pr.title}). Find the cause from the log, fix it, and run the same check locally.\n\n${parts.join('\n\n')}`
  const r = await $.prompt.submit({ text }).catch(() => ({ drop: true }))
  if ('drop' in r && r.drop) await toast($, 'Could not hand the failing checks to Claude')
}

// Each read numbered: an older one that answers after a newer one is dropped
let prReads = 0
// When gh was last asked, so a pending run is read again every 30 s, not on every 15 s tick
let prAt = 0
// The branch and PR last seen with a check pending ("feat/x#7"): kept through an unreadable answer, so the read that
// finds the run finished still tells you
let pendingPr = ''
// Runs seen starting (a PR found pending that was not before), so each run's notice has a key of its own
let runs = 0
// Reads still to make after a push although nothing shows pending yet (GitHub takes a while to start the new run),
// and reads in a row gh could not answer (asking stops after 10, about 5 minutes)
let armed = 0
let unreadable = 0

// The current branch's pull request and its checks, from gh. Not on the base branch (its PRs are other branches'), and
// no checks asked for when gh has no PR or cannot answer (not installed, not logged in, not a GitHub repository)
export async function loadPr($: $, opt: { pushed?: boolean } = {}) {
  if (opt.pushed) armed = 4
  const n = ++prReads
  prAt = await $.clock.now().catch(() => Date.now())
  const s = await look($)
  const br = s.repo.current
  if (!s.repo.isRepo || !br || br === s.git.base) return
  const cwd = (await repoRoot($)) || undefined
  // -- before the branch: a ref named like a flag stays a branch name
  const view = await gh($, ['pr', 'view', '--json', 'number,title,url,state,isDraft,reviewDecision', '--', br], undefined, cwd)
  // gh cannot answer (offline, not logged in, rate limited): the row stays as it was; only "no pull requests" clears it
  // (an answer a newer read has overtaken counts for nothing)
  if (view.exitCode !== 0 && !/no pull requests? found/i.test(view.stderr)) return void (n === prReads && unreadable++)
  // gh pr checks exits 8 while checks are pending and 1 when one failed, printing the JSON all the same
  // A PR with no CI: gh says "no checks reported" with nothing on stdout. Output cut off is unreadable, not "none"
  const checks = view.exitCode === 0 ? await gh($, ['pr', 'checks', '--json', 'name,bucket,link', '--', br], undefined, cwd) : null
  const listed = !checks || ('isStdoutTruncated' in checks && checks.isStdoutTruncated) ? '' : /no checks reported/i.test(checks.stderr) && !checks.stdout.trim() ? '[]' : checks.stdout
  const pr = view.exitCode === 0 ? parsePr(view.stdout, listed) : null
  if (n !== prReads) return
  await set($, st => (st.repo.current === br ? { repo: { ...st.repo, pr } } : {}))
  const key = pr ? `${br}#${pr.number}` : ''
  // No PR, closed or merged, or another branch's: nothing is waited for any more
  if (pendingPr !== key || pr?.state !== 'OPEN') pendingPr = ''
  if (!pr || pr.state !== 'OPEN') return void (armed = 0)
  unreadable = pr.checks.unknown ? unreadable + 1 : 0
  if (pr.checks.unknown) return
  if (pr.checks.pending > 0) {
    if (pendingPr !== key) runs++
    pendingPr = key
    armed = 0
  }
  else if (pendingPr === key) {
    // The same PR was pending and now none is: the run finished; one notice (while you are not watching)
    pendingPr = ''
    if (pr.checks.pass + pr.checks.fail > 0) await tellDone($, ciKey(br, pr.number, runs, pr.checks.fail === 0), { kind: 'ci', number: pr.number, title: pr.title, passed: pr.checks.fail === 0, failing: pr.checks.failing[0]?.name }).catch(() => null)
  }
}

// Called by the 15 s timer while the pane is placed: an open PR with a check still pending is read again once 30 s
// have passed since the last read. Nothing pending, closed, or no PR (a new branch clears it): nothing is asked
export async function livePr($: $) {
  const { pr, current: br } = (await look($)).repo
  const waiting = pr?.checks.unknown ? pendingPr === `${br}#${pr.number}` : (pr?.checks.pending ?? 0) > 0
  if (!pr || pr.state !== 'OPEN' || unreadable >= 10 || !(waiting || armed > 0)) return
  if ((await $.clock.now().catch(() => Date.now())) - prAt < 30_000) return
  if (armed > 0) armed--
  await loadPr($)
}
