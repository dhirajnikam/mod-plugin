import type { Decision } from '../../types'
import type { $ } from '../core/core'
import { look, set, toast, note } from '../core/core'
import { nJ, tally } from './judges'

// The judges' seats, in order: a panel of n takes the first n
const PERSONAS = ['a pragmatic senior engineer', 'a security reviewer', 'a long-term maintainer', 'the end user', 'a sceptic who prefers the safest option', 'a performance engineer', 'a test engineer', 'a software architect', 'a minimalist who prefers less code']

// What the judges read where no evidence is given: a summary of the conversation, or the task where none comes
async function recentContext($: $, task: string, q: string) {
  // privacy: judge-context (docs/privacy.md lists what it sends)
  const r = await $.model.fork({ prompt: `In at most 120 words, state the task and the facts that matter for this decision: "${q}". No preamble.` }).catch(() => null)
  return r?.isAnswered ? r.text : task
}

// Decisions that publish, push, delete, merge, send or are otherwise hard to undo: the judges only advise on these
const RISKY = /\b(public|publish|push|pushed|delete|remove|merge|deploy|release|send|post|email|force|drop|reset|overwrite|revoke|pay|purchase|production|prod|permissions?|settings?|config|rules?|allow|credentials?|tokens?|secrets?|passwords?|keys?|auth|login)\b/i

// Questions only the person can answer, about what they saw, did or want: the judges never take these. What to do
// next among things the person asked for ("Which … should I build first?"), and anything about the judges themselves,
// are theirs too
const PERSONAL = /^(did|does|do you|have you|has it|is it|are you|was it|were you|should i|shall i|would you|will you|can you|could you|want|wants)\b|\b(did|you see|you saw|in your (pane|terminal|screen|app|session|browser)|look right|work for you|for you now|your (preference|choice|call)|do you want|do you prefer|you'?d (like|prefer)|is (this|that|it) the right|right (size|amount|look|level)|judges?)\b|\bwhich\b[^?]*\b(should i|first|next)\b/i
// A reply that needs the person's own words ("Tweak it first", "Something else"): no judge can say what they would
const OPEN = /^other\b|\b(tweak|something else|adjust|change (it|something)|let me|my own|explain)\b/i

// A question the judges never take: only the person can answer it, or one of its replies needs their own words
function personsOwn(question: string, labels: string[]) {
  return PERSONAL.test(question) || labels.some(l => OPEN.test(l))
}
// A question that reads as hard to undo, in its own words or in any reply's
function hardToUndo(question: string, replies: { label?: string | undefined; description?: string | undefined }[]) {
  return RISKY.test([question, ...replies.map(o => `${o.label ?? ''} ${o.description ?? ''}`)].join(' '))
}

// The decisions the session keeps
const DECISIONS_KEPT = 50
// A new decision on the list, waiting to be scored
const newDecision = (id: string, q: string, opts: string[], at: number): Decision => ({ id, q, opts, at, score: 0, signals: [], votes: [], status: 'scoring', result: '' })

export function openDecision($: $, id: string, q: string, opts: string[], at: number, kind?: 'next') {
  return set($, st => ({ decisions: [...st.decisions, { ...newDecision(id, q, opts, at), ...(kind ? { kind } : {}) }].slice(-DECISIONS_KEPT) }))
}

// Score a question's complexity, seat 3/6/9 judges and let them vote; returns the winning label, or '' on a split.
// act false: the judges only advise (their pick is kept as advice, the decision stays the person's). evidence: what
// the judges read in place of a summary of the conversation (the autopilot's roadmap, commits and diff)
export async function judge($: $, id: string, q: string, opts: { label: string; description?: string }[], act = true, evidence = '') {
  const s0 = await look($)
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
  } catch {
    // An answer that cannot be read keeps the middle score, 5
  }
  const n = nJ(score)
  await set($, s => ({
    activity: `Judging · ${n} judges`,
    decisions: s.decisions.map(d => (d.id === id ? { ...d, score, signals, votes: Array(n).fill(-1), reasons: Array(n).fill(''), status: d.status === 'you' ? 'you' : 'voting' } : d)),
  }))
  const brief = evidence || (await recentContext($, s0.task, q))
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
  const d = (await look($)).decisions.find(x => x.id === id) as Decision
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

// Claude's questions (the AskUserQuestion tool), each a decision on the list and one more on the running flow. In Auto
// mode the judges answer them. Returns their answers, or none where the person answers: the judges are off, a question
// is the person's own, they only advise (Ask me mode, or a decision that is hard to undo), or they split. The first
// question is then marked as waiting for the person
export async function judgeQuestions($: $, qs: { question: string; multiSelect?: boolean | undefined; options: { label: string; description?: string }[] }[], useId: string | undefined) {
  const s = await look($)
  const at = await $.clock.now()
  // chat/drawings.tsx finds a call's decisions by the tool call's id at the front of theirs
  const asked = qs.map((q, i) => ({ ...q, id: `${useId ?? at}-${i}` }))
  const ids = asked.map(q => q.id)
  await set($, st => ({
    decisions: [...st.decisions, ...asked.map(q => newDecision(q.id, q.question, q.options.map(o => o.label), at))].slice(-DECISIONS_KEPT),
    flows: st.flows.map((f, i) => (i === st.flows.length - 1 && f.status === 'running' ? { ...f, decisions: f.decisions + asked.length } : f)),
  }))
  const toPerson = async () => {
    await set($, { waiting: ids[0] ?? '', activity: 'Waiting for your answer' })
    return { ids, answers: null }
  }
  const judgeable = asked.every(q => !q.multiSelect && q.options.length >= 2 && !personsOwn(q.question, q.options.map(o => o.label)))
  if (s.mode === 'off' || !judgeable) return toPerson()
  // Ask me, or a decision that is hard to undo: the judges advise while the question waits for you
  if (s.mode === 'ask' || asked.some(q => hardToUndo(q.question, q.options))) {
    for (const q of asked) void judge($, q.id, q.question, q.options, false).catch(() => null)
    return toPerson()
  }
  const answers: Record<string, string> = {}
  for (const q of asked) {
    const win = await judge($, q.id, q.question, q.options)
    if (!win) return toPerson()
    answers[q.question] = win
  }
  await set($, { activity: 'Judges decided' })
  return { ids, answers }
}

// The person answered the questions that waited for them: nothing waits, and each decision the judges had not made
// says what they chose
export function personAnswered($: $, ids: string[], answers: Record<string, string>) {
  return set($, st => ({
    waiting: '',
    decisions: st.decisions.map(d => (ids.includes(d.id) && d.status !== 'decided' ? { ...d, status: 'you', result: answers[d.q] ? `You chose · ${answers[d.q]}` : 'Answered by you' } : d)),
  }))
}

// Answers the judges may give in a row with nobody's own prompt between: the next decision is then the person's.
// judgeNext's note says "three" in words
const JUDGED_IN_A_ROW = 3
export async function personSpoke($: $, at: number) {
  await set($, { personAt: at, judgedRun: 0 })
}

// The app's next-step box: Claude ends a turn with a question and reply buttons. In Auto mode the judges vote between
// the buttons and the winner's reply is sent as the next prompt; they only advise where the decision is hard to undo,
// where they split, where the winner is an app action they cannot press, after three in a row, and in Ask me mode.
// Returns the question when it is left waiting for you
export async function judgeNext($: $, input: Record<string, unknown>) {
  const s = await look($)
  const ask = typeof input.ask === 'string' ? input.ask.trim() : ''
  const acts = (Array.isArray(input.actions) ? input.actions : []) as { action?: string; label?: string; message?: string }[]
  // Off, no question, one button, or a question only you can answer (what you saw, did or want): left to you
  if (s.mode === 'off' || !ask || acts.length < 2 || personsOwn(ask, acts.map(a => a.label ?? ''))) return
  const opts = acts.map(a => ({ label: a.label || a.action || 'Option', ...(a.message ? { description: a.message } : {}) }))
  const at = await $.clock.now()
  // The tool call's own id keeps two next steps apart
  const id = `next-${String(input.tool_use_id ?? '')}-${at}`
  await openDecision($, id, ask, opts.map(o => o.label), at, 'next')
  // The app's own merge and pull-request buttons are hard to undo whatever their labels say
  const risky = hardToUndo(ask, acts.map(a => ({ label: a.label, description: a.message }))) || acts.some(a => a.action === 'merge' || a.action === 'create_pr')
  const piloting = s.autopilot?.status === 'running'
  const canAct = s.mode === 'auto' && !risky && (s.judgedRun < JUDGED_IN_A_ROW || piloting)
  const win = await judge($, id, ask, opts, canAct)
  const choice = acts[opts.findIndex(o => o.label === win)]
  const d = (await look($)).decisions.find(x => x.id === id)
  if (!canAct || !win || !choice || choice.action) {
    const why = risky ? ': it is hard to undo, so it is yours to decide' : s.judgedRun >= JUDGED_IN_A_ROW && s.mode === 'auto' ? ': three were answered in a row, so this one is yours' : choice?.action ? ': it is a button only you can press' : ''
    const text = d?.advice ?? (win ? `Judges recommend "${win}"` : d?.result ?? '')
    if (text) await note($, `⚖ ${text}${why}`)
    if (canAct && win && choice?.action) await set($, st => ({ decisions: st.decisions.map(x => (x.id === id ? { ...x, status: 'advised', advice: `Judges recommend "${win}"` } : x)) }))
    return ask
  }
  // Late: you sent a prompt of your own, or Claude asked a newer question, while the judges voted. Not sent
  const now = await look($)
  const mine = now.decisions.findIndex(x => x.id === id)
  if (now.personAt > at || now.decisions.some((x, i) => i > mine && x.kind === 'next')) {
    await set($, st => ({ decisions: st.decisions.map(x => (x.id === id ? { ...x, status: 'advised', advice: `Judges recommended "${choice.label}" (not sent: a newer question or your prompt came first)` } : x)) }))
    return
  }
  await set($, st => ({ judgedRun: st.judgedRun + 1 }))
  await note($, `⚖ Judges chose "${choice.label}" · ${d?.result ?? ''}`)
  await $.prompt.submit({ text: choice.message || choice.label || '' })
}

// "PRODUCT: OPTION <goal> :: <why>" lines from the product owner's answer
// The line may come quoted, bulleted, numbered, bold or as code ("> ", "- ", "1. ", "**…**", "`…`") and end in \r; the goal ends at the first " :: ", so
// a goal may hold "a::b"; a line with no goal before its reason is no option
export function parseOptions(text: string) {
  const seen = new Set<string>()
  return text
    .split(/\r?\n|[\u2028\u2029]/)
    .map(l => l.replace(/[`*]/g, '').replace(/^(?:[\s>#-]|\d+[.)])*/, '').match(/^PRODUCT:\s*OPTION\s+(.*)$/i)?.[1] ?? '')
    .map(rest => {
      // One whitespace before "::", not a run of them: a run would make the search quadratic on a line of spaces
      const m = /(?:^|\s)::(?:\s|$)/.exec(rest)
      return { label: (m ? rest.slice(0, m.index) : rest).trim(), description: m ? rest.slice(m.index + m[0].length).trim() : '' }
    })
    // The rules' own template line ("<the goal>") echoed back is no goal
    .filter(o => o.label && !o.label.startsWith('::') && !/^<[^>]*>$/.test(o.label))
    .map(o => ({ label: o.label.replace(/\s+/g, ' ').slice(0, 200), description: o.description.slice(0, 300) }))
    // The same goal twice is one option, so the judges never split their votes over a repeat
    .filter(o => !seen.has(o.label.toLowerCase()) && !!seen.add(o.label.toLowerCase()))
    .slice(0, 4)
}

// The reasons the judges who voted for an option gave, one per line, each once
export function reasonsFor(d: Decision, option: number) {
  return [...new Set(d.votes.flatMap((v, i) => (v === option && d.reasons?.[i] ? [d.reasons[i]] : [])))]
}
