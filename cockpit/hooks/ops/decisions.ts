import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Account, Agent, Autopilot, Changed, RuleFiles, Commit, Decision, Flow, GitForm, Pending, Ph, ThemeId, PlanItem } from '../../types'
import { parseSettings, settingsText } from '../rules'
import { factsOf, featurePrompt, filesSig, importers, isCode, memoryKey, memoryMarkdown, parseFeatures, parseImports, resolveImport } from '../memory'
import { AGENT_TYPES, EXPERTS, PIPELINES, TYPES, recallOf, similarRuns, parseCommit, parseSteps, base, branchName, commitMsg, expertName, inferType, nJ, parseCases, parseReport, tally, verifyState } from '../logic'
import { INITIAL, PANE } from '../state'
import { THEME_IDS } from '../theme'
import type { $ } from './core'
import { cockpitDir, git, note, set, toast } from './core'

// The session's state, declared here as in every module that reads it: the engine reads a state atom from its literal
// plugin and key in the module that names it, so each reader declares the same atom
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-23' })

const PERSONAS = ['a pragmatic senior engineer', 'a security reviewer', 'a long-term maintainer', 'the end user', 'a sceptic who prefers the safest option', 'a performance engineer', 'a test engineer', 'a software architect', 'a minimalist who prefers less code']

async function recentContext($: $, s: Ph, q: string) {
  // privacy: judge-context (docs/privacy.md lists what it sends)
  const r = await $.model.fork({ prompt: `In at most 120 words, state the task and the facts that matter for this decision: "${q}". No preamble.` }).catch(() => null)
  return r?.isAnswered ? r.text : s.task
}

// Score a question's complexity, seat 3/6/9 judges, and let them vote; returns the winning label or '' for a split
// Decisions that publish, push, delete, merge, send or are otherwise hard to undo: the judges only advise on these
export const RISKY = /\b(public|publish|push|pushed|delete|remove|merge|deploy|release|send|post|email|force|drop|reset|overwrite|revoke|pay|purchase|production|prod|permissions?|settings?|config|rules?|allow|credentials?|tokens?|secrets?|passwords?|keys?|auth|login)\b/i

// Questions only the person can answer, about what they saw, did or want: the judges never take these. What to do
// next among things the person asked for ("Which … should I build first?"), and anything about the judges themselves,
// are theirs too
export const PERSONAL = /^(did|does|do you|have you|has it|is it|are you|was it|were you|should i|shall i|would you|will you|can you|could you|want|wants)\b|\b(did|you see|you saw|in your (pane|terminal|screen|app|session|browser)|look right|work for you|for you now|your (preference|choice|call)|do you want|do you prefer|you'?d (like|prefer)|is (this|that|it) the right|right (size|amount|look|level)|judges?)\b|\bwhich\b[^?]*\b(should i|first|next)\b/i
// A reply that needs the person's own words ("Tweak it first", "Something else"): no judge can say what they would
export const OPEN = /^other\b|\b(tweak|something else|adjust|change (it|something)|let me|my own|explain)\b/i

// Score a question's complexity, seat 3/6/9 judges and let them vote; returns the winning label, or '' on a split.
// act false: the judges only advise (their pick is kept as advice, the decision stays the person's)
export async function judge($: $, id: string, q: string, opts: { label: string; description?: string }[], act = true) {
  const s0 = await read($, S)
  // privacy: judge-complexity (docs/privacy.md lists what it sends)
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
    decisions: s.decisions.map(d => (d.id === id ? { ...d, score, signals, votes: Array(n).fill(-1), status: d.status === 'you' ? 'you' : 'voting' } : d)),
  }))
  const brief = await recentContext($, s0, q)
  const menu = opts.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n')
  await Promise.all(
    Array.from({ length: n }, async (_, seat) => {
      // privacy: judge-votes (docs/privacy.md lists what it sends)
      const r = await $.model
        .complete({
          model: 'haiku',
          maxTokens: 20,
          system: `You are ${PERSONAS[seat % PERSONAS.length]} on a panel deciding for a coding agent. Reply with the option number only.`,
          prompt: `Context: ${brief}\n\nQuestion: ${q}\n${menu}`,
        })
        .catch(() => null)
      // No option number in the reply is an abstention (-2), never a vote for the first option
      const pick = Number((r?.isAnswered ? r.text : '').match(/\d+/)?.[0] ?? 0) - 1
      const vote = pick >= 0 && pick < opts.length ? pick : -2
      await set($, s => ({ decisions: s.decisions.map(d => (d.id === id ? { ...d, votes: d.votes.map((v, i) => (i === seat ? vote : v)) } : d)) }))
    }),
  )
  const d = (await read($, S)).decisions.find(x => x.id === id) as Decision
  const t = tally(d)
  const winner = d.opts[t.top] ?? ''
  if (!act) {
    const advice = t.passes ? `Judges recommend "${winner}" · ${t.yes}/${t.n}` : `Judges split ${t.counts.join('/')}: no clear pick`
    await set($, s => ({ decisions: s.decisions.map(x => (x.id === id ? { ...x, advice, status: x.status === 'you' ? 'you' : 'advised' } : x)) }))
    await toast($, advice)
    return t.passes ? winner : ''
  }
  await set($, s => ({
    decisions: s.decisions.map(x => (x.id === id ? { ...x, status: t.passes ? 'decided' : 'split', result: t.passes ? `${t.yes}/${t.n} → ${winner}` : `Split ${t.counts.join('/')} · asking you` } : x)),
  }))
  await toast($, t.passes ? `Judge ${t.yes}/${t.n} · ${winner}` : `Judges split ${t.counts.join('/')} · your call`)
  return t.passes ? winner : ''
}

// Answers the judges gave in a row with nobody's own prompt between: three, then the next decision is the person's
export async function personSpoke($: $, at: number) {
  await set($, { personAt: at, judgedRun: 0 })
}

// The app's next-step box: Claude ends a turn with a question and reply buttons. In Auto mode the judges vote between
// the buttons and the winner's reply is sent as the next prompt; they only advise where the decision is hard to undo,
// where they split, where the winner is an app action they cannot press, after three in a row, and in Ask me mode
export async function judgeNext($: $, input: Record<string, unknown>) {
  const s = await read($, S)
  const ask = typeof input.ask === 'string' ? input.ask.trim() : ''
  const acts = (Array.isArray(input.actions) ? input.actions : []) as { action?: string; label?: string; message?: string }[]
  // Off, no question, one button, or a question only you can answer (what you saw, did or want): left to you
  if (s.mode === 'off' || !ask || acts.length < 2 || PERSONAL.test(ask) || acts.some(a => OPEN.test(a.label ?? ''))) return
  const opts = acts.map(a => ({ label: a.label || a.action || 'Option', ...(a.message ? { description: a.message } : {}) }))
  const at = await $.clock.now()
  // The tool call's own id keeps two next steps apart
  const id = `next-${String(input.tool_use_id ?? '')}-${at}`
  await set($, st => ({ decisions: [...st.decisions, { id, q: ask, opts: opts.map(o => o.label), at, score: 0, signals: [], votes: [], status: 'scoring' as const, result: '', kind: 'next' as const }].slice(-50) }))
  const risky = RISKY.test([ask, ...acts.map(a => `${a.label ?? ''} ${a.message ?? ''}`)].join(' ')) || acts.some(a => a.action === 'merge' || a.action === 'create_pr')
  const piloting = s.autopilot?.status === 'running'
  const canAct = s.mode === 'auto' && !risky && (s.judgedRun < 3 || piloting)
  const win = await judge($, id, ask, opts, canAct)
  const choice = acts[opts.findIndex(o => o.label === win)]
  const d = (await read($, S)).decisions.find(x => x.id === id)
  if (!canAct || !win || !choice || choice.action) {
    const why = risky ? ': it is hard to undo, so it is yours to decide' : s.judgedRun >= 3 && s.mode === 'auto' ? ': three were answered in a row, so this one is yours' : choice?.action ? ': it is a button only you can press' : ''
    const text = d?.advice ?? (win ? `Judges recommend "${win}"` : d?.result ?? '')
    if (text) await note($, `⚖ ${text}${why}`)
    // The autopilot waits for you on what it cannot decide
    if (piloting) await stopAutopilot($, 'paused', `a decision waits for you: ${ask}`)
    if (canAct && win && choice?.action) await set($, st => ({ decisions: st.decisions.map(x => (x.id === id ? { ...x, status: 'advised', advice: `Judges recommend "${win}"` } : x)) }))
    return
  }
  // Late: you sent a prompt of your own, or Claude asked a newer question, while the judges voted. Not sent
  const now = await read($, S)
  const mine = now.decisions.findIndex(x => x.id === id)
  if (now.personAt > at || now.decisions.some((x, i) => i > mine && x.kind === 'next')) {
    await set($, st => ({ decisions: st.decisions.map(x => (x.id === id ? { ...x, status: 'advised', advice: `Judges recommended "${choice.label}" (not sent: a newer question or your prompt came first)` } : x)) }))
    return
  }
  await set($, st => ({ judgedRun: st.judgedRun + 1 }))
  await note($, `⚖ Judges chose "${choice.label}" · ${d?.result ?? ''}`)
  await $.prompt.submit({ text: choice.message || choice.label || '' })
}

// The autopilot: Claude works on a goal cycle after cycle, each cycle one turn Cockpit sends, until the judges agree the
// goal is reached. It pauses for you on a decision only you can make, after three cycles that change nothing, and when
// you stop it; it ends at a budget or a time limit when you set one (none by default: it runs until it is done)
const AP_RULES = `How the autopilot works:
- The roadmap lives in .cockpit/roadmap.md (git-ignored): milestones as "- [ ] <milestone>: <acceptance criteria a test or command can check>". On the first cycle, study the codebase and well-known open-source projects of the same kind for proven patterns, then write it. Keep it current: tick a milestone ("- [x]") only when its criteria pass, and add milestones as you learn.
- Each cycle, take the next unticked milestone: plan, build, then verify (run the project's tests and checks; use the cockpit:prover and cockpit:breaker agents for anything non-trivial, and cockpit:reviewer before you tick it). Keep your task list for the cycle.
- Never push, publish, deploy, delete branches, or change settings, permissions or credentials. If the next step needs one of those, ask, and stop the cycle there.
- End your answer with exactly one last line: "AUTOPILOT: CONTINUE <the next milestone>" or "AUTOPILOT: DONE <why every milestone's criteria pass>".`

export function autopilotPrompt(ap: { goal: string; cycle: number; next: string }, notDone = '') {
  const head = ap.cycle === 1 ? `Autopilot, cycle 1. Goal: ${ap.goal}` : `Autopilot, cycle ${ap.cycle}. Goal: ${ap.goal}\nNext: ${ap.next || 'the next unticked milestone in .cockpit/roadmap.md'}`
  return `${head}${notDone ? `\n\nThe judges found it not done yet: ${notDone}` : ''}\n\n${AP_RULES}`
}

// Its milestones, ticked and in all, from the roadmap
async function roadmapCount($: $) {
  const dir = await cockpitDir($)
  const text = dir ? await $.fs.read(`${dir}/roadmap.md`).catch(() => '') : ''
  const all = String(text).match(/^\s*[-*] \[[ xX]\]/gm) ?? []
  return { done: all.filter(l => /\[[xX]\]/.test(l)).length, total: all.length }
}

// The next cycle's prompt. From inside a hook that holds the turn (a command, a turn's end) the engine refuses it, so it
// goes again from a timer once that hook has returned, as a hand-off does; a second refusal pauses the run
async function sendCycle($: $, notDone = '') {
  const ap = (await read($, S)).autopilot
  if (!ap || ap.status !== 'running') return
  const text = autopilotPrompt(ap, notDone)
  const failed = () => stopAutopilot($, 'paused', 'its next cycle could not be sent')
  const send = async () => {
    const r = await $.prompt.submit({ text })
    if ('drop' in r && r.drop) await failed()
  }
  void send().catch(() => {
    try {
      $.clock.after(20, () => {
        void send().catch(() => failed())
      })
    } catch {
      void failed()
    }
  })
}

export async function startAutopilot($: $, goal: string, budget = 0, hours = 0) {
  const s = await read($, S)
  if (s.autopilot?.status === 'running') return toast($, 'The autopilot is already running: stop it first')
  const at = await $.clock.now()
  await set($, { autopilot: { goal, budget, hours, at, costAt: s.cost, cycle: 1, status: 'running', why: '', next: '', stall: 0, done: 0, total: 0 } })
  await note($, `⟳ Autopilot started: ${goal}${budget ? ` · budget $${budget}` : ' · no budget'}${hours ? ` · ${hours}h` : ''}`)
  // A turn already running ends first; this cycle then starts
  if (!s.isWorking) await sendCycle($)
}

export async function stopAutopilot($: $, status: 'paused' | 'stopped' | 'done', why: string) {
  const ap = (await read($, S)).autopilot
  if (!ap || ap.status !== 'running') return
  await set($, { autopilot: { ...ap, status, why } })
  await note($, `⟳ Autopilot ${status === 'done' ? 'done' : status}: ${why}`)
}

export async function resumeAutopilot($: $) {
  const s = await read($, S)
  if (!s.autopilot || s.autopilot.status === 'running' || s.autopilot.status === 'done') return
  await set($, { autopilot: { ...s.autopilot, status: 'running', why: '', stall: 0, cycle: s.autopilot.cycle + 1 } })
  if (!s.isWorking) await sendCycle($)
}

// A main turn ended while the autopilot runs: read its last line, check the limits, then send the next cycle, or put a
// claim of done to the judges first
export async function autopilotTurnEnd($: $, answer: string, changed: boolean, aborted: boolean, turnAt: number) {
  const s = await read($, S)
  const ap = s.autopilot
  if (!ap || ap.status !== 'running') return
  const now = await $.clock.now()
  const { done, total } = await roadmapCount($)
  const line = answer.trim().split('\n').reverse().find(l => /^\s*AUTOPILOT:/i.test(l)) ?? ''
  const claim = line.match(/AUTOPILOT:\s*(CONTINUE|DONE)\s*(.*)$/i)
  const next = claim?.[1]?.toUpperCase() === 'CONTINUE' ? (claim[2] ?? '').trim() : ap.next
  const stall = !changed && next === ap.next && done <= ap.done ? ap.stall + 1 : 0
  await set($, { autopilot: { ...ap, next, stall, done, total } })
  if (aborted) return stopAutopilot($, 'paused', 'you interrupted the turn')
  if (ap.budget && s.cost - ap.costAt >= ap.budget) return stopAutopilot($, 'stopped', `the $${ap.budget} budget is spent`)
  if (ap.hours && now - ap.at >= ap.hours * 3_600_000) return stopAutopilot($, 'stopped', `the ${ap.hours}h limit is up`)
  if (stall >= 3) return stopAutopilot($, 'paused', 'three cycles in a row changed nothing')
  // A question or next step from this turn is the judges' or yours: their reply, or yours, drives the next turn
  if (s.waiting || s.decisions.some(d => d.at >= turnAt && d.kind === 'next')) return
  if (claim?.[1]?.toUpperCase() === 'DONE') {
    const id = `ap-${now}`
    const q = `Is the autopilot's goal fully achieved? Goal: ${ap.goal}. The claim: ${(claim[2] ?? '').trim() || 'done'}. Roadmap: ${done} of ${total} milestones ticked.`
    await set($, st => ({ decisions: [...st.decisions, { id, q, opts: ['Done', 'Not done yet'], at: now, score: 0, signals: [], votes: [], status: 'scoring' as const, result: '' }].slice(-50) }))
    const win = await judge($, id, q, [{ label: 'Done', description: 'every milestone is ticked and its criteria pass' }, { label: 'Not done yet', description: 'something in the goal or the roadmap is unfinished or unproven' }], true)
    if (win === 'Done' && (total === 0 || done === total)) return stopAutopilot($, 'done', `the judges agree: ${(claim[2] ?? '').trim() || 'the goal is reached'}`)
    await set($, st => ({ autopilot: st.autopilot && { ...st.autopilot, cycle: st.autopilot.cycle + 1 } }))
    return sendCycle($, win === 'Done' ? `${total - done} of ${total} milestones in the roadmap are still unticked` : 'check the goal against every milestone, finish what is missing, and prove it')
  }
  await set($, st => ({ autopilot: st.autopilot && { ...st.autopilot, cycle: st.autopilot.cycle + 1 } }))
  await sendCycle($)
}
