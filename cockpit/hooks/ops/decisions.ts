import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Account, Agent, Autopilot, Changed, RuleFiles, Commit, Decision, Flow, GitForm, Pending, Ph, ThemeId, PlanItem } from '../../types'
import { parseSettings, settingsText } from '../rules'
import { factsOf, featurePrompt, filesSig, importers, isCode, memoryKey, memoryMarkdown, parseFeatures, parseImports, resolveImport } from '../memory'
import { AGENT_TYPES, EXPERTS, PIPELINES, TYPES, recallOf, similarRuns, parseCommit, parseSteps, base, branchName, commitMsg, expertName, inferType, nJ, parseCases, parseReport, slug, tally, verifyState } from '../logic'
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
// act false: the judges only advise (their pick is kept as advice, the decision stays the person's). evidence: what
// the judges read in place of a summary of the conversation (the autopilot's roadmap, commits and diff)
export async function judge($: $, id: string, q: string, opts: { label: string; description?: string }[], act = true, evidence = '') {
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
    decisions: s.decisions.map(d => (d.id === id ? { ...d, score, signals, votes: Array(n).fill(-1), reasons: Array(n).fill(''), status: d.status === 'you' ? 'you' : 'voting' } : d)),
  }))
  const brief = evidence || (await recentContext($, s0, q))
  const menu = opts.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n')
  await Promise.all(
    Array.from({ length: n }, async (_, seat) => {
      // privacy: judge-votes (docs/privacy.md lists what it sends)
      const r = await $.model
        .complete({
          model: 'haiku',
          maxTokens: 90,
          system: `You are ${PERSONAS[seat % PERSONAS.length]} on a panel deciding for a coding agent. Judge from the context's facts, not from how confident a claim sounds. Reply on one line: the option number, then " - ", then your reason in at most 20 words.`,
          prompt: `Context: ${brief}\n\nQuestion: ${q}\n${menu}`,
        })
        .catch(() => null)
      // The vote is the reply's leading number, as asked, else an "option N" it names; none is an abstention (-2),
      // never a vote for the first option
      const text = (r?.isAnswered ? r.text : '').trim()
      const pick = Number(text.match(/^\D{0,12}?(\d+)/)?.[1] ?? text.match(/\boption\s*(?:number\s*)?#?(\d+)/i)?.[1] ?? 0) - 1
      const vote = pick >= 0 && pick < opts.length ? pick : -2
      const why = text.replace(/^\D{0,12}?\d+\s*[-—–:.)]*\s*/, '').split('\n')[0]?.slice(0, 160) ?? ''
      await set($, s => ({ decisions: s.decisions.map(d => (d.id === id ? { ...d, votes: d.votes.map((v, i) => (i === seat ? vote : v)), reasons: (d.reasons ?? []).map((x, i) => (i === seat ? why : x)) } : d)) }))
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

// The autopilot, in two roles. Task: Claude works on one goal, cycle after cycle, each cycle a turn Cockpit sends, until
// the judges agree it is achieved. Product owner: each round it studies the product and where its field is going,
// proposes the next goals, the judges pick one, and Task builds it; then the next round. Both pause for you on what is
// hard to undo, after three cycles that change nothing, and when you stop them; they end at a budget or a time limit
// when you set one (none by default)
const SAFETY = '- Never push, publish, deploy, delete branches, or change settings, permissions or credentials. If the next step needs one of those, ask, and stop the cycle there.'

const TASK_RULES = `How the task runs:
- The roadmap lives in .cockpit/roadmap.md (git-ignored): milestones as "- [ ] <milestone>: <acceptance criteria a test or command can check>", under its title line, which you keep as it is. If it has no milestones yet, study the codebase and well-known open-source projects of the same kind for proven patterns, then write them. Tick a milestone ("- [x]") only when its criteria pass, and add milestones as you learn.
- Each cycle, take the next unticked milestone: plan, build, then verify (run the project's tests and checks; use the cockpit:prover and cockpit:breaker agents for anything non-trivial, and cockpit:reviewer before you tick it). Keep your task list for the cycle.
- Do not redo what the earlier cycles did. Every cycle ticks a milestone or changes code toward one; checking again what already passed is not a cycle's work.
${SAFETY}
- End your answer with exactly one last line: "AUTOPILOT: CONTINUE <the next milestone>" or "AUTOPILOT: DONE <why every milestone's criteria pass>".`

const PRODUCT_RULES = `How the product owner works:
- Keep .cockpit/product.md (git-ignored; write it if it is missing): the vision, each goal built and why, and what you learned about the product and its field.
- Study where the product stands (its code, README, docs, tests and open issues) and where its field is going: search the web for how similar products and well-known open-source projects are moving, what their users ask for, and what is new.
- Propose the next goal: two to four options, each a goal one task can finish and prove with checks, each moving the product toward the vision. Prefer what the trends and the product's gaps make most valuable now.
- Build nothing this round, and ask the person nothing: the judges choose among your options.
${SAFETY}
- End your answer with one line per option, the last lines of your answer: "PRODUCT: OPTION <the goal> :: <why now, from the trends and the product's state>".`

// What the earlier cycles of this goal did, from their flows (each named by its prompt's first line, "Autopilot, cycle
// N. Goal: <goal>"): so a cycle builds on them instead of repeating them; another goal's cycles are left out
export function cycleMemory(flows: Flow[], since: number, goal: string, n = 4) {
  const own = `Goal: ${goal.split('\n')[0]}`
  return flows
    .filter(f => f.startedAt >= since && /^Autopilot, cycle \d+\. /.test(f.task) && f.task.slice(f.task.indexOf('Goal: ')) === own && f.status !== 'running')
    .slice(-n)
    .map(f => {
      const c = f.task.match(/cycle (\d+)/)?.[1] ?? '?'
      const did = f.add || f.del ? `+${f.add} −${f.del} lines` : 'no lines changed'
      return `- cycle ${c}: ${did}${f.ops ? `, ${f.ops} file operations` : ''}${f.commit ? `, committed ${f.commit}` : ''}`
    })
}

export function autopilotPrompt(ap: Autopilot, past: string[] = []) {
  const parts = [ap.cycle === 1 ? `Autopilot, cycle 1. Goal: ${ap.goal}` : `Autopilot, cycle ${ap.cycle}. Goal: ${ap.goal}\nNext: ${ap.next || 'the next unticked milestone in .cockpit/roadmap.md'}`]
  if (ap.role === 'product' && ap.vision) parts.push(`This goal is the product owner's pick, toward the vision: ${ap.vision}`)
  if (past.length) parts.push(`What the earlier cycles of this goal did:\n${past.join('\n')}`)
  if (ap.gaps) parts.push(`The judges found it not done yet. What they said is missing:\n${ap.gaps}\nAdd each as a milestone with criteria a test or command can check and build it, or show in your answer, with the command that proves it, why it is already met.`)
  if ((ap.stuck ?? 0) >= 2) parts.push(`No milestone has been ticked for ${ap.stuck} cycles. Do not repeat the last approach: split the milestone into smaller ones you can tick, or take a different approach.`)
  parts.push(TASK_RULES)
  return parts.join('\n\n')
}

export function productPrompt(ap: Autopilot) {
  const built = ap.shipped?.length ? `\nBuilt so far, oldest first: ${ap.shipped.join('; ')}` : ''
  return `Product owner, round ${ap.round ?? 1}. Vision: ${ap.vision || ap.goal}${built}\n\n${PRODUCT_RULES}`
}

// "PRODUCT: OPTION <goal> :: <why>" lines from the product owner's answer
// The line may come quoted, bulleted or bold ("> ", "- ", "**…**") and end in \r; the goal ends at the first " :: ", so
// a goal may hold "a::b"; a line with no goal before its reason is no option
export function parseOptions(text: string) {
  const seen = new Set<string>()
  return text
    .split('\n')
    .map(l => l.replace(/\r$/, '').replace(/^[\s>*#-]*/, '').replace(/\*\*/g, '').match(/^PRODUCT:\s*OPTION\s+(.*)$/i)?.[1] ?? '')
    .map(rest => {
      const cut = rest.search(/\s+::(\s|$)/)
      return { label: (cut < 0 ? rest : rest.slice(0, cut)).trim(), description: cut < 0 ? '' : rest.slice(cut).replace(/^\s+::/, '').trim() }
    })
    .filter(o => o.label && !o.label.startsWith('::'))
    .map(o => ({ label: o.label.slice(0, 200), description: o.description.slice(0, 300) }))
    // The same goal twice is one option, so the judges never split their votes over a repeat
    .filter(o => !seen.has(o.label.toLowerCase()) && !!seen.add(o.label.toLowerCase()))
    .slice(0, 4)
}

// The reasons the judges who voted for an option gave, one per line, each once
export function reasonsFor(d: Decision, option: number) {
  return [...new Set(d.votes.flatMap((v, i) => (v === option && d.reasons?.[i] ? [d.reasons[i]] : [])))]
}

// Its milestones, ticked and in all, from the roadmap, and the roadmap's text for the judges
async function roadmapCount($: $) {
  const dir = await cockpitDir($)
  const text = String(dir ? await $.fs.read(`${dir}/roadmap.md`).catch(() => '') : '')
  const all = text.match(/^\s*[-*] \[[ xX]\]/gm) ?? []
  return { done: all.filter(l => /\[[xX]\]/.test(l)).length, total: all.length, text }
}

// A new goal starts on a roadmap of its own: one left by another goal is kept in .cockpit/roadmaps/ and the roadmap
// starts again from its title. One already for this goal (a restart) is kept as it is
async function freshRoadmap($: $, goal: string) {
  const dir = await cockpitDir($)
  if (!dir) return
  const path = `${dir}/roadmap.md`
  const old = String(await $.fs.read(path).catch(() => ''))
  const title = `# Roadmap: ${goal}`
  if (old.split('\n')[0]?.trim() === title) return
  if (old.trim()) await $.fs.write(`${dir}/roadmaps/${slug(old.split('\n')[0]?.replace(/^#\s*(Roadmap:)?\s*/i, '') ?? '') || 'roadmap'}-${await $.clock.now()}.md`, old).catch(() => null)
  await $.fs.write(path, `${title}\n\n`).catch(() => null)
}

// The next turn's prompt: a cycle of the task, or the product owner's scouting. From inside a hook that holds the turn
// (a command, a turn's end) the engine refuses it, so it goes again from a timer once that hook has returned, as a
// hand-off does; a second refusal pauses the run
async function sendCycle($: $) {
  const s = await read($, S)
  const ap = s.autopilot
  if (!ap || ap.status !== 'running') return
  const text = ap.phase === 'scout' ? productPrompt(ap) : autopilotPrompt(ap, cycleMemory(s.flows, ap.goalAt ?? ap.at, ap.goal))
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

// A goal's fresh start: cycle 1, nothing ticked, nothing carried
const goalStart = (goal: string, goalAt: number) => ({ goal, goalAt, cycle: 1, next: '', stall: 0, done: 0, total: 0, stuck: 0, gaps: '', claims: 0 })

// Task: role 'task' and the goal. Product owner: role 'product' and the vision; it starts by scouting the first goal
export async function startAutopilot($: $, goal: string, budget = 0, hours = 0, role: 'task' | 'product' = 'task') {
  const s = await read($, S)
  // The product owner's choices are the judges': in Ask me or Off they would be yours, which it never asks for. A
  // refusal is toasted and returned
  const no = s.autopilot?.status === 'running' ? 'The autopilot is already running: stop it first' : role === 'product' && s.mode !== 'auto' ? 'The product owner needs the judges to decide: switch to Auto with /cockpit mode auto' : ''
  if (no) return (await toast($, no), no)
  const at = await $.clock.now()
  const product = role === 'product'
  if (!product) await freshRoadmap($, goal)
  await set($, { autopilot: { ...goalStart(product ? '' : goal, at), budget, hours, at, costAt: s.cost, status: 'running', why: '', role, ...(product ? { vision: goal, round: 1, phase: 'scout' as const, shipped: [] } : {}) } })
  await note($, `${product ? '◈ Product owner started' : '⟳ Autopilot started'}: ${goal}${budget ? ` · budget $${budget}` : ' · no budget'}${hours ? ` · ${hours}h` : ''}`)
  // A turn already running ends first; this cycle then starts
  if (!s.isWorking) await sendCycle($)
  return ''
}

export async function stopAutopilot($: $, status: 'paused' | 'stopped' | 'done', why: string) {
  const ap = (await read($, S)).autopilot
  if (!ap || ap.status !== 'running') return
  await set($, { autopilot: { ...ap, status, why } })
  await note($, `${ap.role === 'product' ? '◈ Product owner' : '⟳ Autopilot'} ${status === 'done' ? 'done' : status}: ${why}`)
}

export async function resumeAutopilot($: $) {
  const s = await read($, S)
  if (!s.autopilot || s.autopilot.status === 'running' || s.autopilot.status === 'done') return
  const ap = s.autopilot
  await set($, { autopilot: { ...ap, status: 'running', why: '', stall: 0, cycle: ap.phase === 'scout' ? ap.cycle : ap.cycle + 1 } })
  if (!s.isWorking) await sendCycle($)
}

// A goal reached: the task ends; the product owner records it and scouts the next one
async function finishGoal($: $, why: string) {
  const ap = (await read($, S)).autopilot
  if (!ap) return
  if (ap.role !== 'product') return stopAutopilot($, 'done', why)
  await set($, { autopilot: { ...ap, ...goalStart('', await $.clock.now()), phase: 'scout', round: (ap.round ?? 1) + 1, asides: 0, shipped: [...(ap.shipped ?? []), ap.goal].slice(-20) } })
  await note($, `◈ Built: ${ap.goal} · ${why}. Scouting the next goal`)
  await sendCycle($)
}

// The facts the judges weigh a claim of done by: the roadmap, the commits since the run began, what is uncommitted,
// and the end of Claude's own answer
async function doneEvidence($: $, ap: Autopilot, roadmap: string, answer: string) {
  const log = await git($, ['log', '--oneline', '-n', '30', `--since=${new Date(ap.goalAt ?? ap.at).toISOString()}`])
  const stat = await git($, ['diff', '--stat', 'HEAD'])
  return [
    `Goal: ${ap.goal}`,
    `Roadmap (.cockpit/roadmap.md):\n${roadmap.slice(0, 5000) || '(empty)'}`,
    `Commits since this goal began:\n${log.stdout.trim() || '(none)'}`,
    `Uncommitted changes:\n${stat.stdout.trim().slice(-1500) || '(none)'}`,
    `The end of Claude's answer:\n${answer.trim().slice(-1500)}`,
  ].join('\n\n')
}

// A main turn ended while the autopilot runs: read its last lines, check the limits, then send the next cycle, put a
// claim of done to the judges, or have the judges pick the product owner's next goal
export async function autopilotTurnEnd($: $, answer: string, changed: boolean, aborted: boolean, turnAt: number) {
  const s = await read($, S)
  const ap = s.autopilot
  if (!ap || ap.status !== 'running') return
  const now = await $.clock.now()
  if (aborted) return stopAutopilot($, 'paused', 'you interrupted the turn')
  if (ap.budget && s.cost - ap.costAt >= ap.budget) return stopAutopilot($, 'stopped', `the $${ap.budget} budget is spent`)
  if (ap.hours && now - ap.at >= ap.hours * 3_600_000) return stopAutopilot($, 'stopped', `the ${ap.hours}h limit is up`)
  // A question or next step from this turn is the judges' or yours: their reply, or yours, drives the next turn
  const asked = s.waiting !== '' || s.decisions.some(d => d.at >= turnAt && d.kind === 'next')
  if (ap.phase === 'scout') return asked ? undefined : scoutEnd($, ap, answer, now)

  const { done, total, text: roadmap } = await roadmapCount($)
  const line = answer.trim().split('\n').reverse().find(l => /^\s*AUTOPILOT:/i.test(l)) ?? ''
  const claim = line.match(/AUTOPILOT:\s*(CONTINUE|DONE)\s*(.*)$/i)
  const next = claim?.[1]?.toUpperCase() === 'CONTINUE' ? (claim[2] ?? '').trim() : ap.next
  // Progress is a milestone ticked or added, or code changed; a reworded "next" is not
  const stall = !changed && done <= ap.done && total <= ap.total ? ap.stall + 1 : 0
  const stuck = done > ap.done ? 0 : (ap.stuck ?? 0) + 1
  await set($, { autopilot: { ...ap, next, stall, stuck, done, total } })
  if (asked) return
  if (stall >= 3 || stuck >= 6) {
    const why = stall >= 3 ? 'three cycles in a row changed nothing' : `six cycles without a milestone ticked (on: ${next || 'the next milestone'})`
    // The product owner does not wait on a goal that is stuck: it sets it aside and picks another
    if (ap.role === 'product') return setAside($, why)
    return stopAutopilot($, 'paused', why)
  }
  if (claim?.[1]?.toUpperCase() === 'DONE') {
    const allTicked = total > 0 && done === total
    const id = `ap-${now}-${ap.cycle}`
    const q = `Is this goal fully achieved? Goal: ${ap.goal}. The claim: ${(claim[2] ?? '').trim() || 'done'}. Roadmap: ${done} of ${total} milestones ticked.`
    await set($, st => ({ decisions: [...st.decisions, { id, q, opts: ['Done', 'Not done yet'], at: now, score: 0, signals: [], votes: [], status: 'scoring' as const, result: '' }].slice(-50) }))
    const evidence = await doneEvidence($, ap, roadmap, answer)
    const win = await judge($, id, q, [{ label: 'Done', description: 'every milestone is ticked and the evidence shows its criteria pass' }, { label: 'Not done yet', description: 'something in the goal or the roadmap is unfinished or unproven by the evidence' }], true, evidence)
    if (win === 'Done' && allTicked) return finishGoal($, `the judges agree: ${(claim[2] ?? '').trim() || 'the goal is reached'}`)
    const d = (await read($, S)).decisions.find(x => x.id === id)
    const said = d ? reasonsFor(d, 1).slice(0, 5) : []
    // No roadmap is no proof: done is claimed against milestones a check can pass
    const gaps =
      total === 0 ? '- .cockpit/roadmap.md has no milestones: write them, with criteria a test or command can check, and tick each that passes'
      : win === 'Done' ? `- ${total - done} of ${total} milestones in the roadmap are still unticked`
      : said.map(r => `- ${r}`).join('\n') || '- the evidence does not show every milestone passing'
    // A second claim in a row on a finished roadmap that took in none of the judges' points: arguing again would only
    // repeat the last cycles, so the task stops for you, and the product owner moves on with the points noted
    if ((ap.claims ?? 0) >= 1 && allTicked && total <= ap.total) {
      if (ap.role === 'product') return finishGoal($, `built; the judges still name open points: ${gaps.replace(/\n/g, ' ')}`)
      return stopAutopilot($, 'paused', `every milestone is ticked but the judges still find it not done: ${gaps.replace(/\n/g, ' ')}`)
    }
    await set($, st => ({ autopilot: st.autopilot && { ...st.autopilot, cycle: st.autopilot.cycle + 1, gaps, claims: allTicked ? (st.autopilot.claims ?? 0) + 1 : 0 } }))
    return sendCycle($)
  }
  await set($, st => ({ autopilot: st.autopilot && { ...st.autopilot, cycle: st.autopilot.cycle + 1, gaps: '', claims: 0 } }))
  await sendCycle($)
}

// The product owner's goal set aside: noted as such, and the next goal scouted. Three in a row set aside means the
// trouble is not the goal: it pauses for you rather than scout and stall without end
async function setAside($: $, why: string) {
  const ap = (await read($, S)).autopilot
  if (!ap) return
  const asides = (ap.asides ?? 0) + 1
  const shipped = [...(ap.shipped ?? []), `${ap.goal} (set aside: ${why})`].slice(-20)
  if (asides >= 3) {
    await set($, { autopilot: { ...ap, asides, shipped } })
    return stopAutopilot($, 'paused', `three goals in a row were set aside, the last: ${ap.goal} (${why})`)
  }
  await set($, { autopilot: { ...ap, ...goalStart('', await $.clock.now()), phase: 'scout', round: (ap.round ?? 1) + 1, asides, shipped } })
  await note($, `◈ Set aside: ${ap.goal} · ${why}. Scouting the next goal`)
  await sendCycle($)
}

// The product owner's scouting turn ended: its options go to the judges, and the one most of them pick is built.
// A split goes to the option with the most votes: the product owner's way is the judges', whatever their margin
async function scoutEnd($: $, ap: Autopilot, answer: string, now: number) {
  const opts = parseOptions(answer)
  if (opts.length < 2) {
    if (ap.stall >= 1) return stopAutopilot($, 'paused', 'the product owner proposed no goals to choose from')
    await set($, { autopilot: { ...ap, stall: ap.stall + 1 } })
    return sendCycle($)
  }
  const id = `po-${now}-${ap.round ?? 1}`
  const q = `Which goal should the product build next, toward the vision: ${ap.vision}?`
  await set($, st => ({ decisions: [...st.decisions, { id, q, opts: opts.map(o => o.label), at: now, score: 0, signals: [], votes: [], status: 'scoring' as const, result: '' }].slice(-50) }))
  const evidence = [`Vision: ${ap.vision}`, `Built so far: ${ap.shipped?.join('; ') || 'nothing yet'}`, `The product owner's study:\n${answer.trim().slice(-4000)}`].join('\n\n')
  const win = await judge($, id, q, opts, true, evidence)
  const d = (await read($, S)).decisions.find(x => x.id === id)
  // No judge gave a usable vote (the model failed or answered off the point): nobody chose, so nothing is built
  if (!win && (!d || tally(d).revealed === 0)) return stopAutopilot($, 'paused', 'no judge gave a usable vote on the next goal')
  const goal = win || opts[tally(d!).top]?.label || ''
  if (!win && d) await set($, st => ({ decisions: st.decisions.map(x => (x.id === id ? { ...x, status: 'decided', result: `Split ${tally(d).counts.join('/')} → ${goal} (most votes)` } : x)) }))
  await freshRoadmap($, goal)
  await set($, st => ({ autopilot: st.autopilot && { ...st.autopilot, ...goalStart(goal, now), phase: 'build' } }))
  const why = d ? reasonsFor(d, opts.findIndex(o => o.label === goal))[0] : ''
  await note($, `◈ Next goal, by the judges: ${goal}${why ? ` · ${why}` : ''}`)
  await sendCycle($)
}
