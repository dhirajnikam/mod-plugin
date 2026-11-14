import type { ThemeId } from '../types'
import type { $ } from './core/core'
import { set, look, openPane, setTheme } from './core/core'
import { THEME_IDS } from './core/theme'
import { runMany, startPipeline } from './agents/agents'
import { EXPERTS, expertName, shortType } from './core/experts'
import { FLOWS } from './flows/flows'
import { pickFlow } from './flows/flows-io'
import { stopAutopilot, resumeAutopilot, startAutopilot } from './judges/autopilot'
import { explainCodebase } from './memory/explain'
import { restructure } from './memory/restructure'
import { TABS, isTab, openTab, showTab } from './pane/tabs'
import { MODES } from './core/modes'

const BUDGET = /^\$\d+(\.\d+)?$/
const HOURS = /^\d+(\.\d+)?h$/

// /cockpit <verb> …: runs the sub-command and returns the command's answer. With no verb, or one it does not know,
// it opens the pane
// origin: where the run came from (the person's Enter is 'composer'), for the one sub-command only the person may give
export async function runCockpitCommand($: $, args: string, origin = '') {
  const words = args.trim().split(/\s+/)
  const [verb = '', arg = ''] = words
  // The autopilot's two roles: task (also `autopilot`) works on one goal until it is achieved; product leads the
  // product toward a vision, goal after goal, the judges choosing each
  if (verb === 'autopilot' || verb === 'task' || verb === 'product') {
    const product = verb === 'product'
    const name = product ? 'Product owner' : 'Autopilot'
    const rest = words.slice(1)
    // stop and resume alone are commands ("task stop using jquery" is a goal), and act only on a run of this role
    if (rest.length === 1 && (rest[0] === 'stop' || rest[0] === 'resume')) {
      const ap = (await look($)).autopilot
      if (ap && (ap.role ?? 'task') !== (product ? 'product' : 'task')) return { text: `The run is ${ap.role === 'product' ? 'the product owner: /cockpit product' : 'a task: /cockpit task'} ${rest[0]}` }
      if (rest[0] === 'stop') return (await stopAutopilot($, 'stopped', 'you stopped it'), { text: `${name} stopped.` })
      return (await resumeAutopilot($), { text: `${name} resumed.` })
    }
    // The first $budget and the first hours count; every word shaped like either is left out of the goal
    const budget = Number(rest.find(w => BUDGET.test(w))?.slice(1) ?? 0)
    const hours = Number(rest.find(w => HOURS.test(w))?.slice(0, -1) ?? 0)
    const goal = rest.filter(w => !BUDGET.test(w) && !HOURS.test(w)).join(' ').trim()
    if (!goal)
      return {
        text: product
          ? 'Usage: /cockpit product [$budget] [hours h] <vision>, e.g. /cockpit product $50 12h the fastest offline-first notes app. Each round it studies the product and its field, the judges pick the next goal, and the task builds it. /cockpit product stop · resume'
          : `Usage: /cockpit ${verb} [$budget] [hours h] <goal>, e.g. /cockpit ${verb} $20 4h add offline sync. Leave out the budget and hours to run until it is done. /cockpit ${verb} stop · resume`,
      }
    const no = await startAutopilot($, goal, budget, hours, product ? 'product' : 'task')
    if (no) return { text: no }
    await showTab($, 'overview')
    return { text: `${name}: ${goal}${budget ? ` · $${budget}` : ' · no budget'}${hours ? ` · ${hours}h` : ''}` }
  }
  if (verb === 'explain') {
    const asked = await explainCodebase($)
    await showTab($, 'overview')
    if (!asked) return { text: 'Open a project folder first' }
    return { text: `Asked Claude to write ${(await look($)).guide?.path ?? 'the codebase guide'}` }
  }
  if (verb === 'restructure') return { text: await restructure($, words.slice(1), origin) }
  if (verb === 'theme') {
    if (!THEME_IDS.includes(arg as ThemeId)) return { text: `Themes: ${THEME_IDS.join(', ')}` }
    await setTheme($, arg as ThemeId)
    return { text: `Cockpit theme: ${arg}` }
  }
  if (verb === 'mode') {
    const mode = MODES.find(m => m.id === arg)
    if (!mode) return { text: `Modes: ${MODES.map(m => `${m.id} (${m.what})`).join(', ')}` }
    await set($, { mode: mode.id })
    return { text: `Decisions: ${mode.status}` }
  }
  // A bare /cockpit tab opens the pane, as it always did; a word that is no tab is answered with the tabs there are
  if (verb === 'tab' && arg) {
    if (!isTab(arg)) return { text: `Tabs: ${TABS.map(x => (x.label.toLowerCase() === x.id ? x.id : `${x.id} (${x.label})`)).join(', ')}` }
    await openTab($, arg)
  }
  if (verb === 'focus') {
    const want = arg.toLowerCase()
    if (want && want !== 'on' && want !== 'off') return { text: 'Use /cockpit focus on, /cockpit focus off, or /cockpit focus to switch' }
    const isOn = want === 'on' ? true : want === 'off' ? false : (await look($)).focus === false
    await set($, { focus: isOn })
    return { text: `Focus ${isOn ? 'on: only your prompts, replies and progress show' : 'off'}` }
  }
  if (verb === 'flow') {
    const flow = arg.toLowerCase()
    const known = ['task', 'plan', ...FLOWS.map(x => x.name)].includes(flow)
    if (known && !(await look($)).flows.length) return { text: 'No flow yet: send a prompt first.' }
    if (flow === 'task') {
      await pickFlow($, 'task')
      await openPane($)
      return { text: 'Task flow: the steps written for this task' }
    }
    if (flow === 'plan') {
      await pickFlow($, 'plan')
      await openPane($)
      return { text: "Plan flow: the steps are Claude's own task list" }
    }
    const f = FLOWS.find(x => x.name === flow)
    if (!f) return { text: `Flows: ${FLOWS.map(x => `${x.name} (${x.steps.join(' › ')})`).join(', ')}` }
    await pickFlow($, f.name)
    await openPane($)
    return { text: `${f.label} flow: ${f.steps.join(' › ')}` }
  }
  // /cockpit run planner reviewer -- review the login: those agents at once, each with that task (the current one without)
  if (verb === 'run') {
    // The first lone -- splits names from the task, which keeps any -- of its own; none given, there is no task
    const rest = args.trim().replace(/^run\b\s*/, '')
    const cut = rest.search(/(?:^|\s)--(?:\s|$)/)
    const names = cut < 0 ? rest : rest.slice(0, cut)
    const task = (cut < 0 ? '' : rest.slice(cut).replace(/^\s*--/, '')).trim()
    const s = await look($)
    const known = [...EXPERTS.map(x => x.type), ...s.custom.map(c => c.type)]
    const types = names.split(/[\s,]+/).filter(Boolean).map(n => known.find(k => k === n || shortType(k) === n || expertName(k).toLowerCase() === n.toLowerCase()) ?? n)
    if (!types.length) return { text: `Name the agents: /cockpit run ${EXPERTS.slice(0, 2).map(x => x.name.toLowerCase()).join(' ')} -- the task` }
    await runMany($, types, task)
    await showTab($, 'agents')
    return { text: `Running ${types.map(expertName).join(', ')}${task ? ` on: ${task}` : ''}` }
  }
  if (verb === 'test') await startPipeline($, 'verify')
  await openPane($)
  return { text: 'Cockpit pane opened.' }
}
