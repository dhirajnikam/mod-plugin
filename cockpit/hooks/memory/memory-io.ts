import type { $ } from '../core/core'
import { repoRoot, cockpitDir, SKIP } from '../core/repos'
import { isCode, parseImports, resolveImport, factsOf, filesSig, featurePrompt, parseFeatures, memoryKey, importers, memoryMarkdown, adoptFiles } from './memory'
import { set, toast, look } from '../core/core'

// Every path git knows under a folder (the session's when none is given): tracked and untracked, ignored left out
function lsFiles($: $, cwd?: string) {
  return $.process.run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd ? { cwd } : {}).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
}

// The project's paths: git's view (tracked and untracked, ignored left out), or a shallow walk outside a repository
export async function loadProject($: $) {
  // From the session's folder, as the Activity tree shows paths
  const r = await lsFiles($)
  let project = r.exitCode === 0 ? r.stdout.split('\0').filter(Boolean) : []
  if (r.exitCode !== 0) {
    // ponytail: depth 3 and 3000 paths; git gives the full view where it exists
    const walk = async (dir: string, depth: number): Promise<string[]> => {
      if (depth > 3 || project.length > 3000) return []
      const entries = await $.fs.list(dir || undefined).catch(() => [])
      const out: string[] = []
      for (const en of entries) {
        if (SKIP(en.name)) continue
        const p = dir ? `${dir}/${en.name}` : en.name
        if (en.kind === 'dir') out.push(...(await walk(p, depth + 1)))
        else if (en.kind === 'file') out.push(p)
      }
      return out
    }
    project = await walk('', 0)
  }
  await set($, { project: project.slice(0, 3000) })
}

// The codebase memory, built from every source file's imports at session start (in the background) and kept in
// .cockpit/memory.json, the index .cockpit/MEMORY.md and a page per feature in .cockpit/memory/
// ponytail: 1500 files and 300 KB a file; a bigger repository is mapped in part, by git's order
export async function buildMemory($: $, rename = false) {
  const root = await repoRoot($)
  const r = await lsFiles($, root)
  if (!root || r.exitCode !== 0) return
  // Each build writes every page once, whatever an earlier load of the mod wrote
  written.clear()
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
  // The features named last time stand, kept up with the files that came or went; a model names them again only on
  // Map again, the first time, or when over a quarter of the files are new to them
  const sig = filesSig(files)
  let saved: { sig?: string; features?: { name: string; what: string; files: string[] }[] } = {}
  try {
    saved = JSON.parse((await $.fs.read(`${root}/.cockpit/memory.json`).catch(() => '')) || '{}')
  } catch {
    // A memory file that does not parse is written again below
  }
  const known = new Set((saved.features ?? []).flatMap(f => f.files))
  const fresh = Object.keys(files).filter(f => !known.has(f)).length
  // ponytail: a quarter new is a guess at "the codebase changed shape"; Map again names them afresh any time
  const kept = !rename && saved.features?.length && (saved.sig === sig || fresh <= Object.keys(files).length / 4) ? adoptFiles(saved.features, files) : undefined
  await set($, { memory: { at: await $.clock.now(), files, facts, ...(kept?.length ? { features: kept, sig } : {}) } })
  await saveMemory($)
  if (!kept?.length && Object.keys(files).length) await nameFeatures($, files, facts, sig)
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
  const fact = text === null ? null : factsOf(rel, text.slice(0, 20_000))
  const at = await $.clock.now()
  await set($, st => {
    const files = { ...st.memory.files }
    const facts = { ...st.memory.facts }
    const came = imports !== null && !(rel in files)
    if (imports === null) {
      delete files[rel]
      delete facts[rel]
    } else {
      files[rel] = imports
      if (fact) facts[rel] = fact
    }
    // A file came or went: the named features take it in or let it go now, and stand for the new file set, so
    // neither this session nor the next has a model name them again for it
    const moved = came || imports === null
    const features = moved && st.memory.features ? adoptFiles(st.memory.features, files) : st.memory.features
    return { memory: { ...st.memory, at, files, facts, features, ...(moved && st.memory.sig ? { sig: filesSig(files) } : {}) } }
  })
  await saveMemory($)
}

// The pages as last written, so an edit that changes one file's page writes that page only
const written = new Map<string, string>()

// The memory as it stands: memory.json, the index and a page per feature; a page whose feature is gone is left saying
// so (the engine cannot delete a file). One that cannot be written goes unsaved, silently
async function saveMemory($: $) {
  const dir = await cockpitDir($)
  if (!dir) return
  const m = (await look($)).memory
  const by = importers(m.files)
  await $.fs.write(`${dir}/memory.json`, JSON.stringify({ version: 3, builtAt: m.at, sig: m.sig ?? '', features: m.features ?? [], files: Object.fromEntries(Object.entries(m.files).map(([f, uses]) => [f, { uses, usedBy: by[f] ?? [], ...m.facts?.[f] }])) }, null, 1)).catch(() => null)
  const pages = memoryMarkdown(m.files, new Date(m.at).toISOString().slice(0, 16).replace('T', ' '), m.features, m.facts)
  for (const en of await $.fs.list(`${dir}/memory`).catch(() => [])) {
    const p = `memory/${en.name}`
    if (en.kind === 'file' && en.name.endsWith('.md') && !(p in pages)) pages[p] = '# Gone\n\nThis feature is no longer in the codebase memory: see [the index](../MEMORY.md).\n'
  }
  for (const [p, text] of Object.entries(pages)) {
    const path = `${dir}/${p}`
    if (written.get(path) === text) continue
    await $.fs.write(path, text).then(() => written.set(path, text)).catch(() => null)
  }
}
