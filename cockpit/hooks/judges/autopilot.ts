import type { Flow, Autopilot } from '../../types'
import type { $ } from '../core/core'
import { look, toast, set, note, submitPrompt } from '../core/core'
import { cockpitDir, git } from '../core/repos'
import { slug } from '../core/text'
import { judge, openDecision, reasonsFor, parseOptions, judgeNext } from './decisions'
import { tally } from './judges'

// The autopilot, in two roles. Task: Claude works on one goal, cycle after cycle, each cycle a turn Cockpit sends, until
// the judges agree it is achieved. Product owner: each round it studies the product and where its field is going,
// proposes the next goals, the judges pick one, and Task builds it; then the next round. Both pause for you on what is
// hard to undo, after three cycles that change nothing, and when you stop them; they end at a budget or a time limit
// when you set one (none by default)

// The rule both roles' prompts carry
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
// What the last four cycles of this goal did, from their flows (each named by its prompt's first line, "Autopilot,
// cycle N. Goal: <goal>"): so a cycle builds on them instead of repeating them; another goal's cycles are left out
function cycleMemory(flows: Flow[], since: number, goal: string) {
  const own = `Goal: ${goal.split('\n')[0]}`
  return flows
    .filter(f => f.startedAt >= since && /^Autopilot, cycle \d+\. /.test(f.task) && f.task.slice(f.task.indexOf('Goal: ')) === own && f.status !== 'running')
    .slice(-4)
    .map(f => {
      const c = f.task.match(/cycle (\d+)/)?.[1] ?? '?'
      const did = f.add || f.del ? `+${f.add} −${f.del} lines` : 'no lines changed'
      return `- cycle ${c}: ${did}${f.ops ? `, ${f.ops} file operations` : ''}${f.commit ? `, committed ${f.commit}` : ''}`
    })
}
function autopilotPrompt(ap: Autopilot, past: string[]) {
  const parts = [ap.cycle === 1 ? `Autopilot, cycle 1. Goal: ${ap.goal}` : `Autopilot, cycle ${ap.cycle}. Goal: ${ap.goal}\nNext: ${ap.next || 'the next unticked milestone in .cockpit/roadmap.md'}`]
  if (ap.role === 'product' && ap.vision) parts.push(`This goal is the product owner's pick, toward the vision: ${ap.vision}`)
  if (past.length) parts.push(`What the earlier cycles of this goal did:\n${past.join('\n')}`)
  if (ap.gaps) parts.push(`The judges found it not done yet. What they said is missing:\n${ap.gaps}\nAdd each as a milestone with criteria a test or command can check and build it, or show in your answer, with the command that proves it, why it is already met.`)
  if ((ap.stuck ?? 0) >= 2) parts.push(`No milestone has been ticked for ${ap.stuck} cycles. Do not repeat the last approach: split the milestone into smaller ones you can tick, or take a different approach.`)
  parts.push(TASK_RULES)
  return parts.join('\n\n')
}
function productPrompt(ap: Autopilot) {
  const built = ap.shipped?.length ? `\nBuilt so far, oldest first: ${ap.shipped.join('; ')}` : ''
  return `Product owner, round ${ap.round ?? 1}. Vision: ${ap.vision || ap.goal}${built}\n\n${PRODUCT_RULES}`
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
// The next turn's prompt: a cycle of the task, or the product owner's scouting. One that cannot be sent pauses the run
async function sendCycle($: $) {
  const s = await look($)
  const ap = s.autopilot
  if (!ap || ap.status !== 'running') return
  const text = ap.phase === 'scout' ? productPrompt(ap) : autopilotPrompt(ap, cycleMemory(s.flows, ap.goalAt ?? ap.at, ap.goal))
  submitPrompt($, text, () => stopAutopilot($, 'paused', 'its next cycle could not be sent'))
}
// A goal's fresh start: cycle 1, nothing ticked, nothing carried
const goalStart = (goal: string, goalAt: number) => ({ goal, goalAt, cycle: 1, next: '', stall: 0, done: 0, total: 0, stuck: 0, gaps: '', claims: 0 })
// Task: role 'task' and the goal. Product owner: role 'product' and the vision; it starts by scouting the first goal
export async function startAutopilot($: $, goal: string, budget = 0, hours = 0, role: 'task' | 'product' = 'task') {
  const s = await look($)
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
  const ap = (await look($)).autopilot
  if (!ap || ap.status !== 'running') return
  await set($, { autopilot: { ...ap, status, why } })
  await note($, `${ap.role === 'product' ? '◈ Product owner' : '⟳ Autopilot'} ${status}: ${why}`)
}
export async function resumeAutopilot($: $) {
  const s = await look($)
  if (!s.autopilot || s.autopilot.status === 'running' || s.autopilot.status === 'done') return
  const ap = s.autopilot
  // A resume is your call to go on: the counts that paused it start again
  await set($, { autopilot: { ...ap, status: 'running', why: '', stall: 0, stuck: 0, cycle: ap.phase === 'scout' ? ap.cycle : ap.cycle + 1 } })
  if (!s.isWorking) await sendCycle($)
}
// A goal reached: the task ends; the product owner records it and scouts the next one
async function finishGoal($: $, why: string) {
  const ap = (await look($)).autopilot
  if (!ap) return
  if (ap.role !== 'product') return stopAutopilot($, 'done', why)
  await nextRound($, ap, 0, shippedWith(ap, ap.goal), `Built: ${ap.goal} · ${why}`)
}
// What the product owner built or set aside, the last twenty
const shippedWith = (ap: Autopilot, entry: string) => [...(ap.shipped ?? []), entry].slice(-20)
// The product owner's next round: the last goal's outcome said in the chat, and the next goal scouted
async function nextRound($: $, ap: Autopilot, asides: number, shipped: string[], said: string) {
  await set($, { autopilot: { ...ap, ...goalStart('', await $.clock.now()), phase: 'scout', round: (ap.round ?? 1) + 1, asides, shipped } })
  await note($, `◈ ${said}. Scouting the next goal`)
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
  const s = await look($)
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
  // Cycles that change nothing pause the task: it is spinning. Cycles that change code without ticking a milestone are
  // work, so the task goes on (told past two to split the milestone or change approach), but not without end: code
  // churned for twelve cycles with nothing ticked is no progress either. The product owner, which has other goals to
  // build, sets such a goal aside after six
  // A DONE claim on a fully ticked roadmap goes to the judges first: checking finished work changes nothing
  const claimsDone = claim?.[1]?.toUpperCase() === 'DONE'
  const allTicked = total > 0 && done === total
  const spinning = stall >= 3
  const limit = ap.role === 'product' ? 6 : 12
  if (!(claimsDone && allTicked) && (spinning || stuck >= limit)) {
    const why = spinning ? 'three cycles in a row changed nothing' : `${limit === 6 ? 'six' : 'twelve'} cycles without a milestone ticked (on: ${next || 'the next milestone'})`
    if (ap.role === 'product') return setAside($, why)
    return stopAutopilot($, 'paused', why)
  }
  if (claimsDone) {
    const id = `ap-${now}-${ap.cycle}`
    const q = `Is this goal fully achieved? Goal: ${ap.goal}. The claim: ${(claim[2] ?? '').trim() || 'done'}. Roadmap: ${done} of ${total} milestones ticked.`
    await openDecision($, id, q, ['Done', 'Not done yet'], now)
    const evidence = await doneEvidence($, ap, roadmap, answer)
    const win = await judge($, id, q, [{ label: 'Done', description: 'every milestone is ticked and the evidence shows its criteria pass' }, { label: 'Not done yet', description: 'something in the goal or the roadmap is unfinished or unproven by the evidence' }], true, evidence)
    if (win === 'Done' && allTicked) return finishGoal($, `the judges agree: ${(claim[2] ?? '').trim() || 'the goal is reached'}`)
    const d = (await look($)).decisions.find(x => x.id === id)
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
  const ap = (await look($)).autopilot
  if (!ap) return
  const asides = (ap.asides ?? 0) + 1
  const shipped = shippedWith(ap, `${ap.goal} (set aside: ${why})`)
  if (asides >= 3) {
    await set($, { autopilot: { ...ap, asides, shipped } })
    return stopAutopilot($, 'paused', `three goals in a row were set aside, the last: ${ap.goal} (${why})`)
  }
  await nextRound($, ap, asides, shipped, `Set aside: ${ap.goal} · ${why}`)
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
  await openDecision($, id, q, opts.map(o => o.label), now)
  const evidence = [`Vision: ${ap.vision}`, `Built so far: ${ap.shipped?.join('; ') || 'nothing yet'}`, `The product owner's study:\n${answer.trim().slice(-4000)}`].join('\n\n')
  const win = await judge($, id, q, opts, true, evidence)
  const d = (await look($)).decisions.find(x => x.id === id)
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

// The next-step box at a turn's end goes to the judges; the autopilot waits for you on what they cannot decide
export async function nextStep($: $, input: Record<string, unknown>) {
  const piloting = (await look($)).autopilot?.status === 'running'
  const waits = await judgeNext($, input)
  if (waits && piloting) await stopAutopilot($, 'paused', `a decision waits for you: ${waits}`)
}
