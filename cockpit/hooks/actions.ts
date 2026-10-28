import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Account, Agent, Decision, Ph, Tester, ThemeId } from '../types'
import { branchName, commitMsg, nJ, parseCases, tally } from './logic'
import { INITIAL, PANE } from './state'
import { themeOf } from './theme'

// The session's Cockpit state (see state.ts)
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-2' })

type $ = EngineInterface
type Patch = Partial<Ph> | ((s: Ph) => Partial<Ph>)

export async function set($: $, patch: Patch) {
  await update($, S, s => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }))
}

export async function toast($: $, text: string) {
  $.ui.toast(`◆ ${text}`)
}

// A line in the chat for work Cockpit ran itself (no tool row exists for it); the model never reads it
export async function note($: $, text: string) {
  await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } }).catch(() => null)
}

async function git($: $, args: string[]) {
  return $.process.run(['git', ...args]).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
}

// Branch, ahead count and uncommitted files with their line counts
export async function refreshRepo($: $) {
  const st = await git($, ['status', '--porcelain', '-b'])
  if (st.exitCode !== 0) return set($, { repo: { isRepo: false, current: '', ahead: 0, changed: [] } })
  const [head = '', ...rest] = st.stdout.split('\n').filter(Boolean)
  const current = head.replace(/^## (No commits yet on )?/, '').split('...')[0] ?? ''
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0)
  const num = await git($, ['diff', '--numstat', 'HEAD'])
  const counts = new Map<string, [number, number]>()
  for (const l of num.stdout.split('\n')) {
    const [a, d, p] = l.split('\t')
    if (p) counts.set(p, [Number(a) || 0, Number(d) || 0])
  }
  const changed = rest.map(l => {
    const path = l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop() ?? ''
    const [add, del] = counts.get(path) ?? [0, 0]
    const code = l.slice(0, 2).trim()
    return { path, add, del, meta: code === '??' ? 'new' : code === 'D' ? 'deleted' : `+${add} −${del}` }
  })
  await set($, s => ({ repo: { isRepo: true, current, ahead, changed }, git: { ...s.git, branch: s.git.branch || current } }))
}

export async function gitInit($: $) {
  const r = await git($, ['init'])
  await toast($, r.exitCode === 0 ? 'Initialised a git repository' : `git init failed: ${r.stderr.trim()}`)
  await refreshRepo($)
}

// Commit the staged files; push and open a PR when the form says so
export async function commit($: $, auto: boolean) {
  const s = await read($, S)
  const g = s.git
  const files = s.repo.changed.filter(f => s.staged[f.path] !== false).map(f => f.path)
  if (!files.length) return toast($, 'Nothing staged to commit')
  if (!g.subject.trim()) return toast($, 'Write a commit subject first')
  if (g.preTest && !(s.testers.pos.status === 'done' && s.testers.neg.status === 'done' && ![...s.testers.pos.cases, ...s.testers.neg.cases].some(c => c.st === 'fail'))) {
    return toast($, 'Run tests first is on: the testers have not passed yet')
  }
  const br = branchName(g, s.repo.current)
  if (br && br !== s.repo.current) {
    const sw = await git($, ['switch', br])
    if (sw.exitCode !== 0) {
      const mk = await git($, ['switch', '-c', br])
      if (mk.exitCode !== 0) return toast($, `Could not switch to ${br}: ${mk.stderr.trim()}`)
    }
  }
  await git($, ['add', '-A', '--', ...files])
  const acct = s.accounts.find(a => a.id === s.accountId)
  const who = acct ? ['-c', `user.name=${acct.name}`, '-c', `user.email=${acct.email}`] : []
  const msg = commitMsg(g, br)
  const args = [...who, 'commit', '-m', msg, ...(g.body ? ['-m', g.body] : []), ...(g.signoff ? ['-s'] : []), ...(g.gpg ? ['-S'] : [])]
  const c = await git($, args)
  if (c.exitCode !== 0) return toast($, `Commit failed: ${(c.stderr || c.stdout).trim().split('\n')[0]}`)
  const sha = (await git($, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
  const extra: string[] = []
  if (auto) extra.push('auto')
  if (g.push && acct?.gh) {
    // ponytail: gh auth switch changes the machine's active GitHub account, not just this push; per-push tokens if that bites
    const sw = await $.process.run(['gh', 'auth', 'switch', '--user', acct.gh]).catch(() => null)
    if (sw?.exitCode !== 0) extra.push(`gh switch to ${acct.gh} failed`)
  }
  if (g.push) {
    const p = await git($, ['push', '-u', 'origin', br])
    extra.push(p.exitCode === 0 ? 'pushed' : 'push failed')
    if (p.exitCode === 0 && g.pr) {
      const pr = await $.process
        .run(['gh', 'pr', 'create', '--base', g.base, '--head', br, '--title', msg, '--body', g.body || msg, ...(g.draft ? ['--draft'] : [])])
        .catch(() => null)
      extra.push(pr?.exitCode === 0 ? `${g.draft ? 'draft PR' : 'PR'} → ${g.base}` : 'PR failed')
    }
  }
  await set($, st => ({
    commits: [{ sha, auto, msg, meta: [br, `${files.length} files`, ...extra].join(' · ') }, ...st.commits],
    staged: {},
    reached: st.reached.includes('Commit') ? st.reached : [...st.reached, 'Commit'],
  }))
  await toast($, `${auto ? 'Auto-committed' : 'Committed'} ${sha}${extra.length ? ` · ${extra.join(' · ')}` : ''}`)
  await note($, `⎇ ${auto ? 'Auto-committed' : 'Committed'} ${sha} · ${msg}`)
  await refreshRepo($)
}

const PERSONAS = ['a pragmatic senior engineer', 'a security reviewer', 'a long-term maintainer', 'the end user', 'a sceptic who prefers the safest option', 'a performance engineer', 'a test engineer', 'a software architect', 'a minimalist who prefers less code']

async function recentContext($: $, s: Ph, q: string) {
  const r = await $.model.fork({ prompt: `In at most 120 words, state the task and the facts that matter for this decision: "${q}". No preamble.` }).catch(() => null)
  return r?.isAnswered ? r.text : s.task
}

// Score a question's complexity, seat 3/6/9 judges, and let them vote; returns the winning label or '' for a split
export async function judge($: $, id: string, q: string, opts: { label: string; description?: string }[]) {
  const s0 = await read($, S)
  const scoreR = await $.model
    .complete({
      model: 'haiku',
      maxTokens: 200,
      prompt: `Rate how complex and risky this decision is for a coding agent, 0 (trivial, reversible) to 10 (security, data loss, irreversible). Question: "${q}" Options: ${opts.map(o => o.label).join(' | ')}. Answer as JSON only: {"score": n, "signals": ["2-4 word reason", "...", "..."]}`,
    })
    .catch(() => null)
  let score = 5
  let signals: string[] = []
  try {
    const j = JSON.parse((scoreR?.isAnswered ? scoreR.text : '{}').replace(/^[^{]*/, '').replace(/[^}]*$/, ''))
    score = Math.max(0, Math.min(10, Math.round(Number(j.score) || 5)))
    signals = Array.isArray(j.signals) ? j.signals.slice(0, 3).map(String) : []
  } catch {}
  const n = nJ(score)
  await set($, s => ({
    activity: `Judging · ${n} judges`,
    decisions: s.decisions.map(d => (d.id === id ? { ...d, score, signals, votes: Array(n).fill(-1), status: 'voting' } : d)),
  }))
  const brief = await recentContext($, s0, q)
  const menu = opts.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n')
  await Promise.all(
    Array.from({ length: n }, async (_, seat) => {
      const r = await $.model
        .complete({
          model: 'haiku',
          maxTokens: 20,
          system: `You are ${PERSONAS[seat % PERSONAS.length]} on a panel deciding for a coding agent. Reply with the option number only.`,
          prompt: `Context: ${brief}\n\nQuestion: ${q}\n${menu}`,
        })
        .catch(() => null)
      const pick = Number((r?.isAnswered ? r.text : '').match(/\d+/)?.[0] ?? 1) - 1
      const vote = pick >= 0 && pick < opts.length ? pick : 0
      await set($, s => ({ decisions: s.decisions.map(d => (d.id === id ? { ...d, votes: d.votes.map((v, i) => (i === seat ? vote : v)) } : d)) }))
    }),
  )
  const d = (await read($, S)).decisions.find(x => x.id === id) as Decision
  const t = tally(d)
  const winner = d.opts[t.top] ?? ''
  await set($, s => ({
    decisions: s.decisions.map(x => (x.id === id ? { ...x, status: t.passes ? 'decided' : 'split', result: t.passes ? `${t.yes}/${t.n} → ${winner}` : `Split ${t.counts.join('/')} · asking you` } : x)),
  }))
  await toast($, t.passes ? `Judge ${t.yes}/${t.n} · ${winner}` : `Judges split ${t.counts.join('/')} · your call`)
  return t.passes ? winner : ''
}

const TESTER_PROMPTS = {
  pos: 'You are the POSITIVE tester. Prove the recent change works as intended: find what changed (git diff, or the files named below), write or run focused tests for the happy paths, and run the existing test suite if there is one.',
  neg: 'You are the NEGATIVE tester. Try to break the recent change: abuse, edge cases, bad input, races, spoofed or missing data. Write and run focused tests that attack it. Do not fix the code.',
}

export async function runTester($: $, key: 'pos' | 'neg') {
  const s = await read($, S)
  const touched = [...new Set(s.ops.filter(o => o.op === 'Write' || o.op === 'Edit').map(o => o.path))].slice(-12)
  const prompt = `${TESTER_PROMPTS[key]}\n\nTask: ${s.task || '(see the git diff)'}\nChanged files: ${touched.join(', ') || '(see git diff)'}\n\nEnd your answer with one line per test case, exactly:\nCASE PASS <case name>\nCASE FAIL <case name> :: <what went wrong>`
  const name = key === 'pos' ? 'Positive tester' : 'Negative tester'
  const r = await $.agent.spawn({ prompt, description: name, subagentType: 'general-purpose' }).catch(e => ({ deny: String(e) }))
  if ('deny' in r && r.deny) {
    await setTester($, key, { status: 'error', cases: [], note: r.deny })
    return toast($, `${name} could not start: ${r.deny}`)
  }
  const agentId = 'agentId' in r ? r.agentId : undefined
  await setTester($, key, { status: 'running', cases: [], startedAt: await $.clock.now(), ...(agentId ? { agentId } : {}) })
  if (agentId) await trackAgent($, { id: agentId, name, type: key === 'pos' ? 'Tester +' : 'Tester −', task: TESTER_PROMPTS[key].split('.')[0] ?? name, prompt })
  await set($, st => ({ reached: st.reached.includes('Verify') ? st.reached : [...st.reached, 'Verify'] }))
  await toast($, `Started the ${name.toLowerCase()}`)
}

export async function setTester($: $, key: 'pos' | 'neg', t: Tester) {
  await set($, s => ({ testers: { ...s.testers, [key]: t } }))
}

export async function finishTester($: $, key: 'pos' | 'neg', text: string) {
  const cases = parseCases(text)
  const fails = cases.filter(c => c.st === 'fail').length
  await set($, s => ({ testers: { ...s.testers, [key]: { ...s.testers[key], status: 'done', cases, ...(cases.length ? {} : { note: 'No CASE lines in its answer' }) } } }))
  await toast($, `${key === 'pos' ? 'Positive' : 'Negative'} tester: ${cases.length - fails}/${cases.length} passed${fails ? ` · ${fails} failing` : ''}`)
  await note($, `${key === 'pos' ? '✓ Positive' : '✗ Negative'} tester · ${cases.length - fails}/${cases.length} passed${fails ? ` · ${fails} failing` : ''}`)
}

export async function trackAgent($: $, a: Pick<Agent, 'id' | 'name' | 'type' | 'task' | 'prompt'>) {
  const at = await $.clock.now()
  await set($, s => ({ agents: [...s.agents.filter(x => x.id !== a.id), { ...a, status: 'running', startedAt: at, tools: 0, log: [] }] }))
}

export async function spawnAgent($: $, task: string, type: string) {
  const r = await $.agent.spawn({ prompt: task, description: task.slice(0, 60), subagentType: type }).catch(e => ({ deny: String(e) }))
  if ('deny' in r && r.deny) return toast($, `Could not start the agent: ${r.deny}`)
  const id = 'agentId' in r ? r.agentId : undefined
  if (id) await trackAgent($, { id, name: type === 'general-purpose' ? 'Agent' : type, type, task, prompt: task })
  await set($, s => ({ ui: { ...s.ui, spawnOpen: false, spawnTask: '', openAgent: id ?? '' } }))
  await toast($, `Started ${type}`)
}

export async function stopAgent($: $, id: string) {
  const r = await $.tool.call({ tool: 'TaskStop', task_id: id }).catch(e => ({ deny: String(e) }))
  const ok = !('deny' in r && r.deny)
  const at = await $.clock.now()
  if (ok) await set($, s => ({ agents: s.agents.map(a => (a.id === id ? { ...a, status: 'stopped', endedAt: at, log: [...a.log, { at, t: 'Stopped by you' }] } : a)) }))
  await toast($, ok ? 'Stopped the agent' : `Could not stop it: ${'deny' in r ? r.deny : ''}`)
}

// Refresh context fill, its breakdown and cost
export async function measure($: $) {
  const u = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  if (!u) return
  const cats = (u.context.breakdown?.categories ?? []).filter(c => c.tokens > 0 && !/free|buffer/i.test(c.name))
  const segs = cats
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 4)
    .map(c => [c.name, c.tokens] as [string, number])
  await set($, {
    ctx: { pct: u.context.percent ?? 0, used: u.context.tokens ?? 0, window: u.context.window, segs },
    cost: u.cost?.usd ?? 0,
  })
}

export async function openPane($: $) {
  const s = await read($, S)
  return $.ui.open({ id: PANE, title: 'Cockpit', backgroundColor: themeOf(s).bg })
}

// Switch theme and repaint the pane's backdrop with it
export async function setTheme($: $, theme: ThemeId) {
  await set($, { theme })
  await openPane($)
  await toast($, `Theme: ${theme}`)
}

// Accounts: the ones saved across sessions, plus the global git identity and each gh login found on this machine
export async function loadAccounts($: $) {
  const saved = ((await $.store.get('accounts')) as Account[] | undefined) ?? []
  const chosen = ((await $.store.get('accountId')) as string | undefined) ?? ''
  const name = (await git($, ['config', '--global', 'user.name'])).stdout.trim()
  const email = (await git($, ['config', '--global', 'user.email'])).stdout.trim()
  const st = await $.process.run(['gh', 'auth', 'status']).catch(() => null)
  const out = `${st?.stdout ?? ''}${st?.stderr ?? ''}`
  const logins = [...out.matchAll(/account (\S+)/g)].map(m => m[1] ?? '')
  const active = out.match(/account (\S+)[^\n]*\n(?:[^\n]*\n)*?\s*- Active account: true/)?.[1] ?? logins[0] ?? ''
  const found: Account[] = []
  if (name || email) found.push({ id: 'global', label: active || name || 'global', name, email, gh: active })
  for (const l of logins) if (l && l !== active) found.push({ id: `gh-${l}`, label: l, name: l, email: `${l}@users.noreply.github.com`, gh: l })
  const accounts = [...saved, ...found.filter(f => !saved.some(a => a.id === f.id))]
  await set($, { accounts, accountId: accounts.some(a => a.id === chosen) ? chosen : (accounts[0]?.id ?? '') })
}

export async function saveAccount($: $, a: Account) {
  if (!a.name.trim() || !a.email.trim()) return toast($, 'An account needs a name and an email')
  const acct = { ...a, id: a.id || `acct-${Date.now()}`, label: a.label.trim() || a.gh.trim() || a.name.trim() }
  const s = await read($, S)
  const accounts = [...s.accounts.filter(x => x.id !== acct.id), acct]
  await $.store.set('accounts', accounts.filter(x => x.id !== 'global' && !x.id.startsWith('gh-') || x.id === acct.id))
  await set($, st => ({ accounts, accountId: acct.id, ui: { ...st.ui, acctOpen: false, acct: { id: '', label: '', name: '', email: '', gh: '' } } }))
  await $.store.set('accountId', acct.id)
  await toast($, `Saved account ${acct.label}`)
}

export async function removeAccount($: $, id: string) {
  const s = await read($, S)
  const accounts = s.accounts.filter(a => a.id !== id)
  await $.store.set('accounts', accounts.filter(x => x.id !== 'global' && !x.id.startsWith('gh-')))
  await set($, { accounts, accountId: accounts[0]?.id ?? '' })
}

export async function useAccount($: $, id: string) {
  await set($, { accountId: id })
  await $.store.set('accountId', id)
}

// Write the chosen identity into this repository's own git config
export async function applyAccount($: $) {
  const s = await read($, S)
  const a = s.accounts.find(x => x.id === s.accountId)
  if (!a) return toast($, 'Pick an account first')
  await git($, ['config', 'user.name', a.name])
  await git($, ['config', 'user.email', a.email])
  await toast($, `This repo now commits as ${a.name} <${a.email}>`)
}

// Read Claude Code's theme setting (dark, light, light-ansi, ...) for the Auto theme
export async function detectTheme($: $) {
  const row = (await $.config.list().catch(() => [])).find(r => r.key === 'theme')
  const isDarkTerm = !/light/i.test(String(row?.value ?? 'dark'))
  const s = await read($, S)
  if (s.isDarkTerm === isDarkTerm) return
  await set($, { isDarkTerm })
  if (s.theme === 'auto') await openPane($)
}
