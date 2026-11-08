import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Account, Agent, Autopilot, Changed, RuleFiles, Commit, Decision, Flow, GitForm, Pending, Ph, ThemeId, PlanItem } from '../../types'
import { parseSettings, settingsText } from '../rules'
import { factsOf, featurePrompt, filesSig, importers, isCode, memoryKey, memoryMarkdown, parseFeatures, parseImports, resolveImport } from '../memory'
import { AGENT_TYPES, EXPERTS, PIPELINES, TYPES, recallOf, similarRuns, parseCommit, parseSteps, base, branchName, commitMsg, expertName, inferType, nJ, parseCases, parseReport, tally, verifyState } from '../logic'
import { INITIAL, PANE } from '../state'
import { THEME_IDS } from '../theme'
import type { $ } from './core'
import { cockpitDir, git, note, repoRoot, set, toast } from './core'

// The session's state, declared here as in every module that reads it: the engine reads a state atom from its literal
// plugin and key in the module that names it, so each reader declares the same atom
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-24' })

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

// The codebase memory, built from every source file's imports at session start (in the background) and kept in
// .cockpit/memory.json and .cockpit/MEMORY.md
// ponytail: 1500 files and 300 KB a file; a bigger repository is mapped in part, by git's order
export async function buildMemory($: $, rename = false) {
  const root = await repoRoot($)
  const r = await git($, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  if (!root || r.exitCode !== 0) return
  const all = r.stdout.split('\0').filter(Boolean)
  const has = new Set(all)
  const src = all.filter(isCode).slice(0, 1500)
  const files: Record<string, string[]> = {}
  const facts: Record<string, { exports: string[]; note: string }> = {}
  for (let i = 0; i < src.length; i += 24) {
    await Promise.all(
      src.slice(i, i + 24).map(async p => {
        const text = await $.fs.read(`${root}/${p}`).catch(() => '')
        files[p] = text.length > 300_000 ? [] : [...new Set(parseImports(p, text).map(x => resolveImport(p, x, f => has.has(f))).filter((x): x is string => !!x))]
        facts[p] = factsOf(p, text.slice(0, 20_000))
      }),
    )
  }
  // The features named last time stand while the same files are there; a new or removed file names them again
  const sig = filesSig(files)
  let saved: { sig?: string; features?: { name: string; what: string; files: string[] }[] } = {}
  try {
    saved = JSON.parse((await $.fs.read(`${root}/.cockpit/memory.json`).catch(() => '')) || '{}')
  } catch {
    // A memory file that does not parse is written again below
  }
  const kept = !rename && saved.sig === sig && saved.features?.length ? saved.features : undefined
  await set($, { memory: { at: await $.clock.now(), files, ...(kept ? { features: kept, sig } : {}) } })
  await saveMemory($)
  if (!kept && Object.keys(files).length) await nameFeatures($, files, facts, sig)
}

// A model names the product's features from each file's exports, first comment and imports, in the background
export async function nameFeatures($: $, files: Record<string, string[]>, facts: Record<string, { exports: string[]; note: string }>, sig: string) {
  await set($, s => ({ memory: { ...s.memory, naming: true } }))
  // privacy: feature-names (docs/privacy.md lists what it sends)
  const r = await $.model.complete({ model: 'sonnet', maxTokens: 6000, system: 'You map codebases. Answer with JSON only.', prompt: featurePrompt(files, facts) }).catch(() => null)
  const named = r && r.isAnswered ? parseFeatures(r.text, files) : []
  await set($, s => ({ memory: { ...s.memory, naming: false, ...(named.length ? { features: named, sig } : {}) } }))
  if (named.length) await saveMemory($)
  else await toast($, 'The features could not be named: they are shown by folder')
}

// One file again after an edit: its imports now, the file's entry dropped when it is gone
export async function updateMemory($: $, path: string) {
  const s = await read($, S)
  const root = await repoRoot($)
  if (!root || !s.memory.at) return
  const abs = path.startsWith('/') || /^[A-Za-z]:/.test(path) ? path.replace(/\\/g, '/') : `${await $.session.cwd().catch(() => root)}/${path}`
  const rel = abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : memoryKey(s.memory.files, path)
  if (!rel || !isCode(rel)) return
  const text = await $.fs.read(`${root}/${rel}`).catch(() => null)
  const known = new Set(Object.keys(s.memory.files))
  const imports = text === null ? null : [...new Set(parseImports(rel, text).map(x => resolveImport(rel, x, f => known.has(f) || f === rel)).filter((x): x is string => !!x))]
  const at = await $.clock.now()
  await set($, st => {
    const files = { ...st.memory.files }
    if (imports === null) delete files[rel]
    else files[rel] = imports
    return { memory: { ...st.memory, at, files } }
  })
  await saveMemory($)
}

async function saveMemory($: $) {
  const dir = await cockpitDir($)
  if (!dir) return
  const m = (await read($, S)).memory
  const by = importers(m.files)
  await $.fs.write(`${dir}/memory.json`, JSON.stringify({ version: 2, builtAt: m.at, sig: m.sig ?? '', features: m.features ?? [], files: Object.fromEntries(Object.entries(m.files).map(([f, uses]) => [f, { uses, usedBy: by[f] ?? [] }])) }, null, 1)).catch(() => null)
  await $.fs.write(`${dir}/MEMORY.md`, memoryMarkdown(m.files, new Date(m.at).toISOString().slice(0, 16).replace('T', ' '), m.features)).catch(() => null)
}
