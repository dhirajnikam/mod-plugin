import type { Agent } from '../../types'
import { AUTO } from '../core/theme'
import type { FeatureMark } from '../memory/memory-map'
import { EXPERTS, isOwn } from './experts'

// A run's state as the word the Agents tab and the chat's cards say
export const STATUS_WORD = { running: 'Running', done: 'Done', stopped: 'Stopped', failed: 'Failed' } as const

// Who started an agent and who provides its type, in the words the Agents tab and the agents graph both say
export const startedBy = (a: Agent, agents: Agent[]) => (a.by === 'agent' ? `the ${agents.find(x => x.id === a.parent)?.name ?? 'agent'}` : a.by === 'you' ? 'you' : a.by === 'pipeline' ? 'a Cockpit pipeline' : a.by === 'claude' ? 'Claude' : 'Claude, outside Cockpit\'s view')
export const providedBy = (a: Agent) => (a.provider === 'engine' ? 'Claude Code' : (a.provider ?? (a.type.includes(':') ? a.type.split(':')[0] : 'Claude Code')))

// The agents and who started them, as a diagram: you, Claude and Cockpit on top, an arrow from each to the agents it
// started (a pipeline's steps under Cockpit), a tester's arrow to the agent whose work it tests, an agent's to the ones
// it started. Running ones are filled and breathe, finished ones outlined; ↗ marks an agent from outside Cockpit
// (Claude's own types, another plugin's). Hovering a box says its task, state, who started it and who provides it
export function agentGraph(agents: Agent[]) {
  const label = new Map<string, string>()
  const seen: Record<string, number> = {}
  for (const a of agents) {
    // Cockpit's own types are its own whoever started them; the engine may name the plugin with its marketplace
    // (cockpit@mod-plugin), so the name before the @ is what counts
    const outside = !isOwn(a.type) && (a.provider ? a.provider.split('@')[0] !== 'cockpit' : true)
    const base = `${outside ? '↗ ' : ''}${a.name}`
    seen[base] = (seen[base] ?? 0) + 1
    label.set(a.id, seen[base] > 1 ? `${base} #${seen[base]}` : base)
  }
  const by = (a: Agent) => (a.by === 'agent' && a.parent && label.has(a.parent) ? label.get(a.parent)! : a.by === 'you' ? 'You' : a.by === 'pipeline' || (a.by === undefined && a.for) ? 'Cockpit' : 'Claude')
  const nodes = new Map<string, { name: string; uses: string[]; what: string; files: string[]; usedBy: string[] }>()
  const node = (n: string, what = '') => nodes.get(n) ?? (nodes.set(n, { name: n, uses: [], what, files: [], usedBy: [] }), nodes.get(n)!)
  for (const a of agents) {
    const me = node(label.get(a.id)!, [a.task, a.status, `started by ${startedBy(a, agents)}`, `provided by ${providedBy(a)}`].filter(Boolean).join('\n'))
    const from = a.for && label.has(a.for) ? null : by(a)
    if (from) node(from).uses.push(me.name)
    if (a.for && label.has(a.for)) me.uses.push(label.get(a.for)!)
  }
  const marks: Record<string, FeatureMark> = {}
  for (const a of agents) marks[label.get(a.id)!] = a.status === 'running' ? 'now' : a.status === 'done' ? 'touched' : 'reached'
  return { nodes: [...nodes.values()], marks }
}

// Agent icons for surfaces that draw SVG: line icons in a tinted tile, coloured by state. A running one turns an arc
// around its tile and breathes (SMIL, drawn in an interactive frame); a finished one wears a badge
export type IconState = 'idle' | 'running' | 'done' | 'failed' | 'stopped' | 'pending'
const SPARK = '<path d="M11 3.5l1.9 5.4 5.4 1.9-5.4 1.9L11 18.1l-1.9-5.4-5.4-1.9 5.4-1.9z"/><path d="M18.5 15v5M16 17.5h5"/>'
const BOT = '<rect x="4.5" y="8" width="15" height="11" rx="3.5"/><path d="M12 4.5V8"/><circle cx="9.5" cy="13.5" r="1.1" fill="currentColor"/><circle cx="14.5" cy="13.5" r="1.1" fill="currentColor"/>'
const ICON_COLORS: Record<IconState, string> = { idle: AUTO.accent, running: '#d39b2a', done: '#3f9b5f', failed: '#d0574f', stopped: '#8b8b8b', pending: '#9b9b9b' }
export function agentIconSvg(type: string, state: IconState) {
  const c = ICON_COLORS[state]
  const body = EXPERTS.find(x => x.type === type)?.icon ?? (isOwn(type) ? SPARK : BOT)
  const live = state === 'running'
  const breathe = live ? '<animate attributeName="opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite"/>' : ''
  const arc = live
    ? `<circle cx="18" cy="18" r="16.5" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="24 80"><animateTransform attributeName="transform" type="rotate" from="0 18 18" to="360 18 18" dur="1.1s" repeatCount="indefinite"/></circle>`
    : ''
  const badge =
    state === 'done' ? `<circle cx="29.5" cy="29.5" r="5.5" fill="${c}"/><path d="M27 29.6l1.7 1.7 3.2-3.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
    : state === 'failed' ? `<circle cx="29.5" cy="29.5" r="5.5" fill="${c}"/><path d="M27.6 27.6l3.8 3.8M31.4 27.6l-3.8 3.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36"><rect x="3" y="3" width="30" height="30" rx="9" fill="${c}" fill-opacity="${state === 'pending' || state === 'stopped' ? 0.1 : 0.16}"/><g transform="translate(6 6)" fill="none" stroke="${c}" color="${c}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${breathe}${body}</g>${arc}${badge}</svg>`
}
