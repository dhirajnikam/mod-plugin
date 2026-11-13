import type { $ } from '../core/core'
import { look, set } from '../core/core'
import { holdEarlyPlan } from '../agents/agents'
import { applyPlan, parseSteps } from './flows'

export function pickFlow($: $, kind: string) {
  return set($, st => ({ flows: st.flows.map((f, i) => (i === st.flows.length - 1 ? { ...f, kind } : f)) }))
}

// The steps of this prompt's task, written by a quick model in the background; the template stands until they come
export async function writeSteps($: $, flowId: string, task: string) {
  // privacy: flow-steps (docs/privacy.md lists what it sends)
  const r = await $.model
    .complete({
      model: 'haiku',
      maxTokens: 400,
      system: 'You plan coding work. Answer with JSON only.',
      prompt: `Break this task for a coding assistant into 3 to 6 steps, in the order they will happen, each under 7 words and specific to this task (name the files or features where you can). Tag each step with the kind of work that reaches it, one of: Understand, Explore, Decide, Implement, Verify, Commit, Answer. A question ends in Answer; a change to code ends in Verify, then Commit. Answer with JSON only: [{"step": "...", "kind": "..."}].\n\nTask: ${task.slice(0, 800)}`,
    })
    .catch(() => null)
  const steps = r && r.isAnswered ? parseSteps(r.text) : []
  if (steps.length >= 2) await set($, s => ({ flows: s.flows.map(f => (f.id === flowId ? { ...f, steps } : f)) }))
}

// The plan after one of Claude's plan tools ran. A task list kept by the main loop is the current flow's; one a
// subagent keeps is that agent's own, its progress
export async function trackPlan($: $, e: { tool: string; agentId?: string }, r: unknown) {
  const { tool, agentId } = e
  // A refused or failed plan call changed no list: a failed TaskCreate has no id, and would leave a ghost task
  if (typeof r !== 'object' || r === null || ('deny' in r && (r as { deny?: unknown }).deny) || ('isError' in r && (r as { isError?: unknown }).isError)) return
  const result = 'result' in r ? (r as { result?: unknown }).result : undefined
  if (agentId) {
    const known = (await look($)).agents.some(a => a.id === agentId)
    if (!known) return void holdEarlyPlan(agentId, held => applyPlan(held, tool, e as Record<string, unknown>, result))
    return set($, s => ({ agents: s.agents.map(a => (a.id === agentId ? { ...a, plan: applyPlan(a.plan ?? [], tool, e as Record<string, unknown>, result) } : a)) }))
  }
  await set($, s => ({
    flows: s.flows.map((f, i) => (i === s.flows.length - 1 ? { ...f, plan: applyPlan(f.plan ?? [], tool, e as Record<string, unknown>, result, s.flows.slice(0, -1).map(x => x.plan ?? [])) } : f)),
  }))
}
