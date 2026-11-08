import { atom, read } from 'claude-code'

import { memoryText } from '../memory'
import { INITIAL } from '../state'
import type { $ } from './core'
import { git, repoRoot, set, toast } from './core'

// The state atom, declared here as in every module that reads it: the engine's scan wants the literal plugin and key
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-25' })

// What Claude is asked to write, and what Cockpit already knows so Claude reads less. Pure, so a test can read it
export function explainPrompt(a: { path: string; exists: boolean; memory: string; readme: string; recent: string[] }) {
  const task = a.exists
    ? `Refresh the codebase guide at ${a.path} in place: check each section against the code now, fix what is stale, add what is missing, and keep every edit the person made by hand.`
    : `Write a codebase guide at ${a.path} (create the file).`
  return [
    `${task} It is for someone new to this project, and for the person to read and then ask you to improve. Cover these sections, in this order:`,
    '1. What the project is for',
    '2. How it is laid out: the folders and the main modules',
    '3. How a request or the data flows through it',
    '4. The main design decisions and the approach: why it is built this way, the patterns used, the trade-offs',
    '5. How to build, test and run it',
    '6. Where to start for common changes',
    'Keep it accurate to the code (read the files before you claim anything), link files by path, and keep it under 400 lines.',
    '',
    'What Cockpit already knows, to save you reading:',
    ...(a.memory ? ['', 'Feature map and facts from its codebase memory:', a.memory] : []),
    ...(a.readme ? ['', 'The README, first lines:', a.readme] : []),
    ...(a.recent.length ? ['', `Files most changed recently: ${a.recent.join(', ')}`] : []),
  ].join('\n')
}

// docs/CODEBASE.md, or CODEBASE.md at the root where there is no docs folder (an existing one stays where it is)
async function guidePath($: $, root: string) {
  for (const p of ['docs/CODEBASE.md', 'CODEBASE.md']) if (await $.fs.exists(`${root}/${p}`).catch(() => false)) return { path: p, exists: true }
  return { path: (await $.fs.exists(`${root}/docs`).catch(() => false)) ? 'docs/CODEBASE.md' : 'CODEBASE.md', exists: false }
}

// The guide's path and when it was last written, for the Overview's row
export async function loadGuide($: $) {
  const root = await repoRoot($)
  if (!root) return
  const g = await guidePath($, root)
  const st = g.exists ? await $.fs.stat(`${root}/${g.path}`).catch(() => null) : null
  await set($, { guide: { path: g.path, at: st?.mtimeMs ?? 0 } })
}

// One prompt to Claude. Where the engine refuses it from here (inside a command's hook, which holds the turn it would
// wait on) it goes again from a timer once that hook has returned
function handOff($: $, text: string, what: string) {
  const send = async () => {
    const r = await $.prompt.submit({ text })
    return !('drop' in r && r.drop)
  }
  const failed = () => void toast($, `Could not hand ${what} to Claude`)
  void send().then(ok => ok || retry(), retry)
  function retry() {
    try {
      $.clock.after(20, () => void send().then(ok => ok || failed(), failed))
    } catch {
      failed()
    }
  }
}

// Explain this codebase (and Refresh): one prompt to Claude
export async function explainCodebase($: $) {
  const root = await repoRoot($)
  if (!root) return toast($, 'Open a project folder first')
  const g = await guidePath($, root)
  const s = await read($, S)
  // ponytail: the README's first 40 lines cut at 2k characters, the memory at 2.6k, the ten most changed files of the last 100 commits
  const readme = (await $.fs.read(`${root}/README.md`).catch(() => '')).split('\n').slice(0, 40).join('\n').slice(0, 2000)
  const counts = new Map<string, number>()
  for (const f of (await git($, ['log', '-n', '100', '--name-only', '--format='])).stdout.split('\n').filter(Boolean)) counts.set(f, (counts.get(f) ?? 0) + 1)
  const recent = [...counts].sort((x, y) => y[1] - x[1]).slice(0, 10).map(x => x[0])
  const memory = Object.keys(s.memory.files).length ? memoryText(s.memory.files, 2600, s.memory.features) : ''
  // privacy: none; the facts go into your own conversation, as a prompt you could have pasted (docs/privacy.md)
  await set($, { guide: { path: g.path, at: s.guide?.at ?? 0 } })
  handOff($, explainPrompt({ ...g, memory, readme, recent }), 'the request')
}

// The person's change to the guide, handed to Claude as written
export async function editGuide($: $, text: string) {
  const path = (await read($, S)).guide?.path
  if (!path || !text.trim()) return
  await set($, st => ({ ui: { ...st.ui, guideText: '' } }))
  handOff($, `Edit ${path}: ${text.trim()}`, 'the change')
}
