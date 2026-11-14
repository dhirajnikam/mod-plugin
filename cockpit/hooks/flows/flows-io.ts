import type { $ } from '../core/core'
import { set } from '../core/core'
import { parseSteps } from './flows'

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
