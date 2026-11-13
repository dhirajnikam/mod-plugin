import { cut, workOf } from '../core/text'
import type { PlanItem, Ph } from '../../types'

// Every step a flow can reach, in order. A flow shows its own template's steps plus any it reaches beyond them
const STEPS = ['Understand', 'Explore', 'Decide', 'Implement', 'Verify', 'Commit', 'Answer']
// The predefined flows: each prompt picks one from its words, and progress is measured against that flow's steps
export const FLOWS: { name: string; label: string; steps: string[]; what: string }[] = [
  { name: 'build', label: 'Build', steps: ['Understand', 'Explore', 'Implement', 'Verify', 'Commit'], what: 'a feature, fix or refactor' },
  { name: 'docs', label: 'Docs', steps: ['Understand', 'Explore', 'Implement', 'Commit'], what: 'README, docs, comments' },
  { name: 'check', label: 'Check', steps: ['Understand', 'Explore', 'Verify', 'Answer'], what: 'review, verify, run the tests' },
  { name: 'answer', label: 'Answer', steps: ['Understand', 'Explore', 'Answer'], what: 'a question, an explanation' },
]
// The flow a prompt is on: from its words, and from what was reached: a question that starts editing files is a Build
export function flowOf(task: string, reached: string[] = [], kind?: string) {
  const t = task.trim().toLowerCase()
  const docs = workOf(t) === 'docs'
  const pick = (name: string) => FLOWS.find(f => f.name === name) ?? FLOWS[0]!
  if (kind && FLOWS.some(f => f.name === kind)) return pick(kind)
  if (reached.includes('Implement')) return pick(docs ? 'docs' : 'build')
  if (/\b(review|check|verify|audit|lint|make sure|run (the )?tests?|does it work)\b/.test(t)) return pick('check')
  if (/\?\s*$/.test(t) || /^(what|why|how|where|which|who|when|is|are|does|can|could|should|explain|show|list|tell|describe|summari[sz]e)\b/.test(t)) return pick('answer')
  return pick(docs ? 'docs' : 'build')
}
// Progress of one flow. Its steps are Claude's own task list while it keeps one (each task's status as Claude set it),
// else the flow template the words of the prompt pick, with any step reached beyond it added. A step done counts 1,
// the one in progress ½: progress is that over the number of steps. A flow picked by hand stands over both
export function progressOf(task: string, reached: string[], isWorking: boolean, kind?: string, plan: PlanItem[] = [], own: { name: string; kind: string }[] = []) {
  const template = !!kind && kind !== 'plan' && kind !== 'task'
  // Steps written for the task: the furthest one whose kind of work was reached is in progress, the ones before it done
  if (own.length && !template && (kind === 'task' || !plan.length)) {
    const last = own.reduce((m, x, i) => (reached.includes(x.kind) ? i : m), -1)
    const steps = own.map((x, i) => ({ name: x.name, st: stepState(i, last, reached.includes(x.kind), isWorking) }))
    const flow = { name: 'task', label: 'Task', steps: steps.map(x => x.name), what: 'steps written for this task' }
    return { flow, steps, ...tallySteps(steps), stepName: steps.find(x => x.st === 'active')?.name ?? (reached.length ? 'Idle' : 'Ready') }
  }
  if (plan.length && !template) {
    const steps = plan.map(p => ({ name: cut(p.text, 48), st: p.st === 'completed' ? 'done' : p.st === 'in_progress' ? 'active' : 'pending' }))
    const flow = { name: 'plan', label: 'Plan', steps: steps.map(x => x.name), what: "Claude's own task list" }
    const t = tallySteps(steps)
    return { flow, steps, ...t, stepName: steps.find(x => x.st === 'active')?.name ?? (t.done === steps.length ? 'Done' : isWorking ? 'Working' : 'Idle') }
  }
  const flow = flowOf(task, reached, template ? kind : undefined)
  const names = STEPS.filter(n => flow.steps.includes(n) || reached.includes(n))
  const last = names.reduce((m, name, i) => (reached.includes(name) ? i : m), -1)
  const steps = names.map((name, i) => ({ name, st: stepState(i, last, reached.includes(name), isWorking) }))
  return { flow, steps, ...tallySteps(steps), stepName: steps.find(x => x.st === 'active')?.name ?? (reached.length ? 'Idle' : 'Ready') }
}
// A step's state on a template or written steps: the furthest one reached is in progress while the turn runs and done
// after; one before it is done if its work was reached, else skipped (shown so, and left out of the count)
function stepState(i: number, last: number, isReached: boolean, isWorking: boolean) {
  if (i > last) return 'pending'
  if (i === last) return isWorking ? 'active' : 'done'
  return isReached ? 'done' : 'skipped'
}
// Progress: (steps done + ½ × steps in progress) ÷ the steps that count, a skipped one not among them
function tallySteps(steps: { st: string }[]) {
  const done = steps.filter(x => x.st === 'done').length
  const active = steps.filter(x => x.st === 'active').length
  const skipped = steps.filter(x => x.st === 'skipped').length
  const total = steps.length - skipped
  return { done, active, skipped, total, pct: total ? Math.round(((done + active / 2) / total) * 100) : 0 }
}
// Steps a model wrote for a task, kept only where each names a known kind of work
export function parseSteps(text: string) {
  try {
    const arr = JSON.parse(text.match(/\[\s*\{[\s\S]*\]/)?.[0] ?? '[]') as { step?: unknown; kind?: unknown }[]
    return arr
      .map(x => ({ name: String(x.step ?? '').trim().slice(0, 60), kind: STEPS.find(k => k.toLowerCase() === String(x.kind ?? '').toLowerCase()) ?? '' }))
      .filter(x => x.name && x.kind)
      .slice(0, 7)
  } catch {
    return []
  }
}
export const progress = (s: Ph) => {
  const f = s.flows[s.flows.length - 1]
  // Before the first prompt there is no task, so nothing has progressed (a pipeline started by hand included)
  if (!f) return progressOf('', [], false)
  return progressOf(s.task, s.reached, s.isWorking, f.kind, f.plan, f.steps)
}
// Claude's task list after one of its plan tools: TodoWrite sends the whole list; TaskCreate adds one (its id is in the
// result), TaskUpdate changes or deletes one by id. An update to a task of an earlier prompt's plan carries that plan over
export function applyPlan(plan: PlanItem[], tool: string, input: Record<string, unknown>, result: unknown, earlier: PlanItem[][] = []): PlanItem[] {
  const st = (x: unknown): PlanItem['st'] => (x === 'completed' || x === 'in_progress' ? x : 'pending')
  // This app's task list: items replace it; advance finishes the task in progress and starts the next; done and start
  // name tasks by their 1-based place; the turn's wrap-up ticks off the rest
  if (tool === 'mcp__ccd_turn__update_plan') {
    if (Array.isArray(input.items)) return (input.items as Record<string, unknown>[]).map((t, i) => ({ id: `p${i}`, text: String(t.content ?? ''), st: st(t.status) })).filter(p => p.text)
    let next = plan.map(p => ({ ...p }))
    if (input.advance === true) {
      const at = next.findIndex(p => p.st === 'in_progress')
      if (at >= 0) next[at] = { ...next[at]!, st: 'completed' }
      const go = next.findIndex((p, i) => i > at && p.st === 'pending')
      if (go >= 0) next[go] = { ...next[go]!, st: 'in_progress' }
    }
    for (const n of Array.isArray(input.done) ? (input.done as number[]) : []) if (next[n - 1]) next[n - 1] = { ...next[n - 1]!, st: 'completed' }
    if (typeof input.start === 'number' && next[input.start - 1]) next = next.map((p, i) => (i === (input.start as number) - 1 ? { ...p, st: 'in_progress' } : p.st === 'in_progress' ? { ...p, st: 'completed' } : p))
    return next
  }
  if (tool === 'mcp__ccd_turn__wrap_up') return plan.map(p => ({ ...p, st: 'completed' as const }))
  if (tool === 'TodoWrite') {
    const todos = Array.isArray(input.todos) ? (input.todos as Record<string, unknown>[]) : []
    return todos.map((t, i) => ({ id: `t${i}`, text: String(t.content ?? ''), st: st(t.status) })).filter(p => p.text)
  }
  if (tool === 'TaskCreate') {
    const id = String(((result as { task?: { id?: unknown } } | undefined)?.task?.id) ?? `c${plan.length}`)
    return [...plan.filter(p => p.id !== id), { id, text: String(input.subject ?? ''), st: 'pending' as const }].filter(p => p.text)
  }
  if (tool === 'TaskUpdate') {
    const id = String(input.taskId ?? '')
    const base = plan.some(p => p.id === id) ? plan : earlier.slice().reverse().find(e => e.some(p => p.id === id)) ?? plan
    if (input.status === 'deleted') return base.filter(p => p.id !== id)
    return base.map(p => (p.id === id ? { ...p, ...(input.subject ? { text: String(input.subject) } : {}), ...(input.status ? { st: st(input.status) } : {}) } : p))
  }
  return plan
}
// An agent's progress from its own task list: done of all, and the task it is on (the next one when none is started)
export function planProgress(plan: PlanItem[] = []) {
  const done = plan.filter(p => p.st === 'completed').length
  const now = plan.find(p => p.st === 'in_progress') ?? plan.find(p => p.st === 'pending')
  return { done, total: plan.length, now: now?.text ?? '' }
}
