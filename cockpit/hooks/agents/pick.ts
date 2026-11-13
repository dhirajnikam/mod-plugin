// Chooses an agent's model, effort and helper count from the task: a small table of rules, nothing learned.
// A level is a step on one ladder; the kind sets where it starts and the task's words and size move it.
import { EXPERTS, shortType } from './experts'

const LADDER = [
  { model: 'haiku', effort: 'low' },
  { model: 'sonnet', effort: 'low' },
  { model: 'sonnet', effort: 'medium' },
  { model: 'sonnet', effort: 'high' },
  { model: 'opus', effort: 'high' },
  { model: 'opus', effort: 'xhigh' },
] as const

const LIGHT = /\b(rename|typo|docs?|readme|changelog|comment|format(ting)?|wording|copy|lint|bump)\b/gi
const STRONG = /\b(refactor|architecture|security|debug|race|concurren\w*|migrat\w*|auth\w*|deadlock|performance|rewrite)\b/gi
const found = (re: RegExp, t: string) => [...new Set((t.match(re) ?? []).map(w => w.toLowerCase()))]

type Pick = { model: 'haiku' | 'sonnet' | 'opus'; effort: 'low' | 'medium' | 'high' | 'xhigh'; agents: number; why: string }

// kind: the agent type ('cockpit:planner', 'Explore'); files: how many files the change touches, 0 when unknown
export function pickRun(task: string, kind: string, files = 0): Pick {
  // Matched by short name: the person's own agent called "builder" starts where Cockpit's builder does
  const k = shortType(kind)
  const expert = EXPERTS.find(x => shortType(x.type) === k)
  const light = found(LIGHT, task)
  const strong = found(STRONG, task)
  const long = task.length > 600
  const big = files >= 8
  const raw = (expert?.start ?? 2) - Math.min(light.length, 2) + Math.min(strong.length, 2) + (long ? 1 : 0) + (big ? 1 : 0)
  const level = Math.max(0, Math.min(LADDER.length - 1, raw))
  const why = [expert?.why, light.length ? `light work (${light.join(', ')})` : '', strong.length ? `hard work (${strong.join(', ')})` : '', long ? 'long brief' : '', big ? `${files} files` : ''].filter(Boolean)
  // ponytail: Cockpit's pipelines run one expert at a time, so the count is recorded, not used
  return { ...LADDER[level]!, agents: level >= 4 && big && k === 'builder' ? 2 : 1, why: why.join(', ') || 'a usual task' }
}

// The short line on an agent's row
export const pickLabel = (p: Pick) => `${p.model} · ${p.effort} — ${p.why}`
