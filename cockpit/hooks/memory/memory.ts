// The codebase memory: which source file imports which, the features (folders) they make up, and what a change
// to one file reaches. Pure: memory-io.ts reads the files and keeps the result; every path is from the repository root.

const CODE = /\.(m?[jt]sx?|cjs|dart|py|css|scss|vue|svelte)$/i
const SKIP = /(^|\/)(node_modules|dist|build|out|\.next|coverage|vendor|\.venv|venv|__pycache__)\//

export const isCode = (path: string) => CODE.test(path) && !SKIP.test(path)

// The import specifiers a file names: quoted relative paths after import, from, export, require or import() (JS, TS,
// Dart, CSS and the like), and Python's from-imports and imports, kept as dotted names
export function parseImports(path: string, text: string): string[] {
  const out = new Set<string>()
  if (/\.py$/i.test(path)) {
    for (const m of text.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\s+([\w*, ()]+)/gm)) {
      const mod = m[1] ?? ''
      if (!/^\.+$/.test(mod)) out.add(mod)
      // "from . import a, b": each name may be a module of its own
      else for (const n of (m[2] ?? '').replace(/[()]/g, '').split(',')) if (n.trim() && n.trim() !== '*') out.add(`${mod}${n.trim()}`)
    }
    for (const m of text.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) for (const n of (m[1] ?? '').split(',')) out.add(n.trim())
    return [...out].filter(Boolean)
  }
  for (const m of text.matchAll(/(?:\bimport\b|\bfrom\b|\bexport\b(?:[^'"\n]*\bfrom\b)?|\bpart\b|\brequire\s*\(|\bimport\s*\(|@import\s*(?:url\()?)\s*['"]([^'"\n]+)['"]/g)) out.add(m[1] ?? '')
  return [...out].filter(Boolean)
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
function join(dir: string, rel: string) {
  const parts = dir ? dir.split('/') : []
  for (const seg of rel.split('/')) {
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts', '.dart', '.css', '.scss', '.vue', '.svelte', '.json']

// The repository file a specifier names, or null for a package or anything not in the repository
export function resolveImport(from: string, spec: string, has: (p: string) => boolean): string | null {
  if (/\.py$/i.test(from)) {
    const dots = spec.match(/^\.*/)?.[0].length ?? 0
    const name = spec.slice(dots).replace(/\./g, '/')
    let base = dots ? dirOf(from) : ''
    for (let i = 1; i < dots; i++) base = dirOf(base)
    const stem = join(base, name)
    // An absolute module is looked for from the root and from the file's own folder
    for (const c of [`${stem}.py`, `${stem}/__init__.py`, ...(dots ? [] : [`${join(dirOf(from), name)}.py`])]) if (has(c)) return c
    return null
  }
  // Dart and CSS name a file in the same folder bare ('src/a.dart', "base.css"); a scheme (package:, dart:, http:) is not one
  const bare = /\.(dart|s?css)$/i.test(from) && !/^\w+:/.test(spec)
  if (!spec.startsWith('.') && !spec.startsWith('/') && !bare) return null
  const stem = spec.startsWith('/') ? spec.slice(1) : join(dirOf(from), spec)
  if (stem === null) return null
  for (const e of EXTS) if (has(stem + e)) return stem + e
  for (const e of EXTS.slice(1)) if (has(`${stem}/index${e}`)) return `${stem}/index${e}`
  // ESM TypeScript names its imports by the compiled file: './b.js' is b.ts
  const js = stem.match(/^(.*)\.(m|c)?js(x?)$/)
  for (const c of js ? [`${js[1]}.${js[2] ?? ''}ts${js[3]}`, `${js[1]}.tsx`] : []) if (has(c)) return c
  return null
}

// A file's feature: its folder, two levels deep at most ("cockpit/hooks"); a file at the root is "(root)"
const featureOf = (path: string) => dirOf(path).split('/').filter(Boolean).slice(0, 2).join('/') || '(root)'

export type Files = Record<string, string[]>
// A feature as people name it: what it is for, and the files that make it up. The model writes these; folders stand in
type Named = { name: string; what: string; files: string[] }
export type Feature = Named & { uses: string[]; usedBy: string[] }

export function importers(files: Files) {
  const by: Record<string, string[]> = {}
  for (const [f, imps] of Object.entries(files)) for (const i of imps) (by[i] ??= []).push(f)
  return by
}

// The feature each file belongs to: the named features first (a file in one only), the rest by their folder
function membership(files: Files, named: Named[] = []) {
  const of: Record<string, string> = {}
  for (const n of named) for (const f of n.files) if (files[f] && !of[f]) of[f] = n.name
  for (const f of Object.keys(files)) of[f] ??= featureOf(f)
  return of
}

// A feature made only of tests: it imports everything it checks, so the map lists it apart instead of drawing its arrows
export const isTestFeature = (f: { files: string[] }) => f.files.length > 0 && f.files.every(p => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i.test(p))

export const memberOf = (files: Files, named: Named[], path: string) => membership(files, named)[path] ?? featureOf(path)

// The features, each with what it is for, its files and the features it uses and is used by (from the imports between
// their files), biggest first
export function features(files: Files, named: Named[] = []): Feature[] {
  const of = membership(files, named)
  const what = new Map(named.map(n => [n.name, n.what]))
  const map = new Map<string, Feature>()
  const get = (n: string) => map.get(n) ?? (map.set(n, { name: n, what: what.get(n) ?? '', files: [], uses: [], usedBy: [] }), map.get(n)!)
  for (const f of Object.keys(files)) get(of[f]!).files.push(f)
  for (const [f, imps] of Object.entries(files)) {
    const a = of[f]!
    for (const i of imps) {
      const b = of[i] ?? featureOf(i)
      if (a === b) continue
      if (!get(a).uses.includes(b)) get(a).uses.push(b)
      if (!get(b).usedBy.includes(a)) get(b).usedBy.push(a)
    }
  }
  return [...map.values()].sort((x, y) => y.files.length - x.files.length || x.name.localeCompare(y.name))
}

// What a change to one file reaches: its feature, what it imports, who imports it, every file that depends on it
// within `depth` steps, and the features those are in
export function impactOf(files: Files, path: string, depth = 3, named: Named[] = []) {
  const by = importers(files)
  const of = membership(files, named)
  const reached = new Set<string>()
  let edge = [path]
  for (let d = 0; d < depth && edge.length; d++) {
    edge = edge.flatMap(f => by[f] ?? []).filter(f => f !== path && !reached.has(f))
    for (const f of edge) reached.add(f)
  }
  const affected = [...reached]
  const feature = of[path] ?? featureOf(path)
  return { feature, uses: files[path] ?? [], usedBy: by[path] ?? [], affected, features: [...new Set(affected.map(f => of[f] ?? featureOf(f)))].filter(f => f !== feature) }
}

// The memory key for a path as the session names it (absolute, or relative to a subfolder): the file it ends with
export function memoryKey(files: Files, path: string) {
  const p = path.replace(/\\/g, '/')
  if (files[p]) return p
  const keys = Object.keys(files)
  return keys.filter(k => p.endsWith(`/${k}`)).sort((a, b) => b.length - a.length)[0] ?? keys.find(k => k.endsWith(`/${p}`)) ?? ''
}

// What a file shows of itself to the model naming the features: the names it exports and its first comment line
export function factsOf(path: string, text: string) {
  const exports = /\.py$/i.test(path)
    ? [...text.matchAll(/^(?:def|class)\s+(\w+)/gm)].map(m => m[1] ?? '')
    : [...text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+(\w+)/g)].map(m => m[1] ?? '')
  const note = text.match(/^\s*(?:\/\/+|#+|\/\*+|\*+)\s*([A-Za-z].{10,})$/m)?.[1]?.replace(/\*\/\s*$/, '').trim().slice(0, 120) ?? ''
  return { exports: [...new Set(exports)].filter(Boolean).slice(0, 8), note }
}

// A stable name for a set of files: the features are written again only when files come or go
export function filesSig(files: Files) {
  let h = 0
  for (const k of Object.keys(files).sort()) for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0
  return `${Object.keys(files).length}:${(h >>> 0).toString(36)}`
}

export function featurePrompt(files: Files, facts: Record<string, { exports: string[]; note: string }>) {
  const lines = Object.keys(files)
    .sort()
    .slice(0, 400)
    .map(f => {
      const x = facts[f]
      const imps = (files[f] ?? []).map(i => i.split('/').pop()).join(', ')
      return `${f}${x?.exports.length ? ` | exports ${x.exports.join(', ')}` : ''}${x?.note ? ` | "${x.note}"` : ''}${imps ? ` | imports ${imps}` : ''}`
    })
  return `These are the source files of a repository, each with what it exports, its first comment and what it imports.\n\n${lines.join('\n')}\n\nGroup them into the product's features as a person would name them (for example "Hero section", "Contact form", "Theme toggle", "Commit flow"), not by folder. Each feature: a short name of two to four words, one plain sentence on what it does for the user or the codebase, and every file that makes it up. Put shared code (data, types, helpers, styles, config, tests) in features of its own named for what it is. Every file in exactly one feature. Answer with JSON only: [{"name": "...", "what": "...", "files": ["path", ...]}].`
}

// The features the model wrote, kept only for files the repository has; each file in the first feature that names it
export function parseFeatures(text: string, files: Files): Named[] {
  try {
    const arr = JSON.parse(text.match(/\[\s*\{[\s\S]*\]/)?.[0] ?? '[]') as { name?: unknown; what?: unknown; files?: unknown }[]
    const seen = new Set<string>()
    return arr
      .map(x => ({
        name: String(x.name ?? '').trim().slice(0, 40),
        what: String(x.what ?? '').trim().slice(0, 200),
        files: (Array.isArray(x.files) ? x.files.map(String) : []).filter(f => files[f] && !seen.has(f) && (seen.add(f), true)),
      }))
      .filter(x => x.name && x.files.length)
  } catch {
    return []
  }
}

// The memory as Claude reads it each session: every feature on one short line with its page, so none is cut, and the
// detail left to the pages. It changes only when the features do, so the prompt's cache holds from turn to turn
export function memoryText(files: Files, max = 2600, named: Named[] = []) {
  const fs = features(files, named)
  const slugs = featureSlugs(fs.map(f => f.name))
  const head = `Cockpit's map of this repository: ${Object.keys(files).length} source files in ${fs.length} features. Check it first, before searching or reading code: pick the feature, open its page in .cockpit/memory/ (index: .cockpit/MEMORY.md), which says for each file what it does, exports and imports and what imports it, then open the file. A change reaches the files that import it.`
  const line = (f: Feature, i: number, what: boolean) => `- ${f.name} (memory/${slugs[i]}.md)${what && f.what ? `: ${f.what.length > 100 ? `${f.what.slice(0, 99)}…` : f.what}` : ''}`
  let lines = [head, ...fs.map((f, i) => line(f, i, true))]
  // Too long with what each does: every feature by name and page still beats a few in full
  if (lines.join('\n').length > max) lines = [head, ...fs.map((f, i) => line(f, i, false))]
  let out = ''
  for (const l of lines) {
    if (out.length + l.length + 1 > max) return `${out}- …`
    out += `${l}\n`
  }
  return out.trimEnd()
}

const STOP = new Set('the and for with this that from into what when then than have has are was were you your can could should would will not but all any its our out use add fix make code file files change please also just like need want them they there here how why does did done'.split(' '))
const wordsOf = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []

// Recall, as a person does from a cue: the features this prompt's words name (in a feature's name, what it does, its
// file names or exports) and the ones worked on lately, the strongest first, each with its page and its files' paths.
// Empty when nothing comes to mind. recent: paths of the files read or changed lately
// ponytail: word overlap, not meaning; a feature named in other words is not recalled, the map in the prompt still is
export function recall(files: Files, named: Named[], facts: Record<string, { exports: string[] }>, prompt: string, recent: string[] = [], n = 3) {
  const cue = new Set(wordsOf(prompt).filter(w => !STOP.has(w)))
  const fs = features(files, named)
  const slugs = featureSlugs(fs.map(f => f.name))
  const hot = new Set(recent)
  // A word in a feature's name, a file's name or an export names the feature (2). A word only in the prose of what it
  // does is a hint (1), and none at all when three or more features' prose has it ("claude", "after"). One hint alone
  // recalls nothing: a prompt about something else used to bring up three features on words like "work"
  const naming = (f: Feature) => new Set(wordsOf([f.name, ...f.files.map(p => p.split('/').pop()!.replace(/\.[^.]+$/, '')), ...f.files.flatMap(p => facts[p]?.exports ?? [])].join(' ')))
  const prose = fs.map(f => new Set(wordsOf(f.what)))
  const common = (w: string) => prose.filter(p => p.has(w)).length >= 3
  const scored = fs
    .map((f, i) => {
      const strong = naming(f)
      const hits = [...cue].reduce((a, w) => a + (strong.has(w) ? 2 : prose[i]!.has(w) && !common(w) ? 1 : 0), 0)
      const isHot = f.files.some(p => hot.has(p))
      // Recent work lifts a feature the prompt hints at; it recalls none by itself (Claude has that work in front of it)
      return { f, slug: slugs[i]!, score: hits >= 2 ? hits + (isHot ? 1 : 0) : hits && isHot ? 2 : 0 }
    })
    .filter(x => x.score > 0 && !isTestFeature(x.f))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
  if (!scored.length) return ''
  return [
    `Cockpit's memory recalls these parts of the codebase for this prompt. Check them first: open the page, then the files it names.`,
    ...scored.map(({ f, slug }) => `- ${f.name} (.cockpit/memory/${slug}.md): ${f.files.slice(0, 6).join(', ')}${f.files.length > 6 ? ', …' : ''}${f.usedBy.length ? `; used by ${f.usedBy.slice(0, 4).join(', ')}` : ''}`),
  ].join('\n')
}

// The named features kept up with the files as they are now, so a file that comes or goes needs no model to name them
// again: a gone file leaves its feature, and a new one joins the feature most of its folder is in, else the one most
// of the files it imports or is imported by are in. A file with neither stays out (its folder stands in for it)
export function adoptFiles(named: Named[], files: Files): Named[] {
  const out = named.map(n => ({ ...n, files: n.files.filter(f => f in files) }))
  const owner = new Map<string, Named>()
  for (const n of out) for (const f of n.files) if (!owner.has(f)) owner.set(f, n)
  const by = importers(files)
  const best = (near: string[]) => {
    const votes = new Map<Named, number>()
    for (const g of near) {
      const n = owner.get(g)
      if (n) votes.set(n, (votes.get(n) ?? 0) + 1)
    }
    return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
  for (const f of Object.keys(files).sort()) {
    if (owner.has(f)) continue
    const n = best([...owner.keys()].filter(g => dirOf(g) === dirOf(f))) ?? best([...(files[f] ?? []), ...(by[f] ?? [])])
    if (!n) continue
    n.files.push(f)
    owner.set(f, n)
  }
  return out.filter(n => n.files.length)
}

// Each feature's page name under .cockpit/memory/: the name a model gave it cut to [a-z0-9-], so no name can leave the
// folder, and numbered when two names cut to the same one
export function featureSlugs(names: string[]) {
  const seen = new Set<string>()
  return names.map(n => {
    const base = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'feature'
    let slug = base
    for (let i = 2; seen.has(slug); i++) slug = `${base}-${i}`
    seen.add(slug)
    return slug
  })
}

// Markdown table cells: a pipe or a line break would end the cell early
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')

type Facts = Record<string, { exports: string[]; note: string }>

// The memory as pages, keyed by their path under .cockpit/: the index (MEMORY.md: the codebase in short, one row per
// feature, the folders) and a page per feature (memory/<slug>.md: its files by folder, each with what it does, what it
// exports and imports, and what imports it), so Claude opens one page to find the file to change
export function memoryMarkdown(files: Files, when: string, named: Named[] = [], facts: Facts = {}): Record<string, string> {
  const by = importers(files)
  const fs = features(files, named)
  const slugs = featureSlugs(fs.map(f => f.name))
  const folders: Record<string, number> = {}
  for (const f of Object.keys(files)) folders[dirOf(f) || '(root)'] = (folders[dirOf(f) || '(root)'] ?? 0) + 1
  const index = [
    `# Codebase memory`,
    ``,
    `Written by Cockpit, ${when}: ${Object.keys(files).length} source files in ${fs.length} features${named.length ? ' (named by a model from what each file exports)' : ' (by folder)'}, and how they connect through their imports. Rebuilt at each session start, updated after each edit. Each feature's page lists its files: what each does, exports and imports, and what imports it.`,
    ``,
    `## Features`,
    ``,
    `| Feature | What it does | Files | Uses | Used by |`,
    `|---|---|---|---|---|`,
    ...fs.map((f, i) => `| [${cell(f.name)}](memory/${slugs[i]}.md) | ${cell(f.what)} | ${f.files.length} | ${cell(f.uses.join(', '))} | ${cell(f.usedBy.join(', '))} |`),
    ``,
    `## Folders`,
    ``,
    ...Object.entries(folders)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, n]) => `- \`${d}\`: ${n} ${n === 1 ? 'file' : 'files'}`),
    ``,
  ]
  const pages: Record<string, string> = { 'MEMORY.md': index.join('\n') }
  fs.forEach((f, i) => {
    const out = [`# ${f.name}`, ``, `[← Codebase memory](../MEMORY.md)`, ``]
    if (f.what) out.push(f.what, ``)
    if (f.uses.length) out.push(`Uses: ${f.uses.join(', ')}  `)
    if (f.usedBy.length) out.push(`Used by: ${f.usedBy.join(', ')}  `)
    out.push(``)
    // Its files under a heading for each folder they sit in
    const byDir: Record<string, string[]> = {}
    for (const file of f.files) (byDir[dirOf(file) || '(root)'] ??= []).push(file)
    for (const d of Object.keys(byDir).sort()) {
      out.push(`## \`${d}\``, ``)
      for (const file of byDir[d]!.sort()) {
        const fact = facts[file]
        const parts = [
          fact?.note ? fact.note.replace(/\.?$/, '.') : '',
          fact?.exports.length ? `Exports ${fact.exports.join(', ')}.` : '',
          files[file]?.length ? `Imports ${files[file]!.map(x => `\`${x}\``).join(', ')}.` : '',
          by[file]?.length ? `Imported by ${by[file]!.map(x => `\`${x}\``).join(', ')}.` : '',
        ].filter(Boolean)
        out.push(`- \`${file.split('/').pop()}\`${parts.length ? `: ${parts.join(' ')}` : ''}`)
      }
      out.push(``)
    }
    pages[`memory/${slugs[i]}.md`] = out.join('\n')
  })
  return pages
}
