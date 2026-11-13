import type { $ } from '../core/core'
import { repoRoot, git, cockpitDir } from '../core/repos'
import { isCode, parseImports, resolveImport, factsOf, filesSig, featurePrompt, parseFeatures, memoryKey, importers, memoryMarkdown } from './memory'
import { set, toast, look } from '../core/core'

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
async function nameFeatures($: $, files: Record<string, string[]>, facts: Record<string, { exports: string[]; note: string }>, sig: string) {
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
  const s = await look($)
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

// The memory as it stands, written to both files; one that cannot be written goes unsaved, silently
async function saveMemory($: $) {
  const dir = await cockpitDir($)
  if (!dir) return
  const m = (await look($)).memory
  const by = importers(m.files)
  await $.fs.write(`${dir}/memory.json`, JSON.stringify({ version: 2, builtAt: m.at, sig: m.sig ?? '', features: m.features ?? [], files: Object.fromEntries(Object.entries(m.files).map(([f, uses]) => [f, { uses, usedBy: by[f] ?? [] }])) }, null, 1)).catch(() => null)
  await $.fs.write(`${dir}/MEMORY.md`, memoryMarkdown(m.files, new Date(m.at).toISOString().slice(0, 16).replace('T', ' '), m.features)).catch(() => null)
}
