import type { Ph, Tab } from '../../types'
import type { $ } from '../core/core'
import { openPane, set } from '../core/core'
import { discoverAgentTypes, syncAgents } from '../agents/agents'
import { refreshGit, loadProject } from '../git/git'
import { loadGuide } from '../memory/explain'
import { loadRules } from '../rules/rules-io'

// The pane's tabs, in the order they are drawn; the stored id 'files' is the Activity tab
const LABELS: Record<Tab, string> = { overview: 'Overview', files: 'Activity', agents: 'Agents', git: 'Git', rules: 'Rules' }
export const TABS = (Object.keys(LABELS) as Tab[]).map(id => ({ id, label: LABELS[id] }))
export const isTab = (x: string): x is Tab => Object.hasOwn(LABELS, x)

// Reads again what a tab shows
async function loadTab($: $, tab: Tab): Promise<unknown> {
  switch (tab) {
    case 'overview':
      return loadGuide($)
    case 'files':
      return loadProject($)
    case 'agents':
      return Promise.all([discoverAgentTypes($), syncAgents($)])
    case 'git':
      return refreshGit($)
    case 'rules':
      return loadRules($)
  }
}

// Opens a tab, however it was asked for (its button, /cockpit tab, a link from another tab): what the tab shows is read
// again as it opens. `ui` sets what is open inside it in the same write
export async function openTab($: $, tab: Tab, ui: Partial<Ph['ui']> = {}) {
  await set($, s => ({ tab, ui: { ...s.ui, ...ui } }))
  return loadTab($, tab)
}

// The same from outside the pane (a card or a band label in the chat, a command): the pane is opened on the tab first,
// so a press shows it at once, and the tab's reading follows
export async function showTab($: $, tab: Tab, ui: Partial<Ph['ui']> = {}) {
  await set($, s => ({ tab, ui: { ...s.ui, ...ui } }))
  await openPane($)
  // The pane is open on the tab; a reading that fails must not lose a command's answer or a press
  await Promise.resolve(loadTab($, tab)).catch(() => null)
}
