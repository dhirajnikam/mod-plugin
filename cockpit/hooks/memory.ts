// The codebase memory: which source file imports which, the features (folders) they make up, and what a change
// to one file reaches. Pure: actions.ts reads the files and keeps the result; every path is from the repository root.

// Source files whose imports are read
export const CODE = /\.(m?[jt]sx?|cjs|dart|py|css|scss|vue|svelte)$/i
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
      if (/^\.+$/.test(mod)) for (const n of (m[2] ?? '').replace(/[()]/g, '').split(',')) if (n.trim() && n.trim() !== '*') out.add(`${mod}${n.trim()}`)
    }
    for (const m of text.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) for (const n of (m[1] ?? '').split(',')) out.add(n.trim())
    return [...out].filter(Boolean)
  }
  for (const m of text.matchAll(/(?:\bimport\b|\bfrom\b|\bexport\b[^'"\n]*\bfrom\b|\brequire\s*\(|\bimport\s*\(|@import)\s*['"]([^'"\n]+)['"]/g)) out.add(m[1] ?? '')
  return [...out].filter(Boolean)
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
function join(dir: string, rel: string) {
  const parts = dir ? dir.split('/') : []
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
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
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null
  const stem = spec.startsWith('/') ? spec.slice(1) : join(dirOf(from), spec)
  for (const e of EXTS) if (has(stem + e)) return stem + e
  for (const e of EXTS.slice(1)) if (has(`${stem}/index${e}`)) return `${stem}/index${e}`
  return null
}

// A file's feature: its folder, two levels deep at most ("cockpit/hooks"); a file at the root is "(root)"
export const featureOf = (path: string) => dirOf(path).split('/').filter(Boolean).slice(0, 2).join('/') || '(root)'

export type Files = Record<string, string[]>
export type Feature = { name: string; files: string[]; uses: string[]; usedBy: string[] }

// Who imports each file
export function importers(files: Files) {
  const by: Record<string, string[]> = {}
  for (const [f, imps] of Object.entries(files)) for (const i of imps) (by[i] ??= []).push(f)
  return by
}

// The features, each with its files and the features it uses and is used by, biggest first
export function features(files: Files): Feature[] {
  const map = new Map<string, Feature>()
  const get = (n: string) => map.get(n) ?? (map.set(n, { name: n, files: [], uses: [], usedBy: [] }), map.get(n)!)
  for (const f of Object.keys(files)) get(featureOf(f)).files.push(f)
  for (const [f, imps] of Object.entries(files)) {
    const a = featureOf(f)
    for (const i of imps) {
      const b = featureOf(i)
      if (a === b) continue
      if (!get(a).uses.includes(b)) get(a).uses.push(b)
      if (!get(b).usedBy.includes(a)) get(b).usedBy.push(a)
    }
  }
  return [...map.values()].sort((x, y) => y.files.length - x.files.length || x.name.localeCompare(y.name))
}

// What a change to one file reaches: what it imports, who imports it, every file that depends on it within `depth`
// steps, and the features those are in
export function impactOf(files: Files, path: string, depth = 3) {
  const by = importers(files)
  const reached = new Set<string>()
  let edge = [path]
  for (let d = 0; d < depth && edge.length; d++) {
    edge = edge.flatMap(f => by[f] ?? []).filter(f => f !== path && !reached.has(f))
    for (const f of edge) reached.add(f)
  }
  const affected = [...reached]
  return {
    feature: featureOf(path),
    uses: files[path] ?? [],
    usedBy: by[path] ?? [],
    affected,
    features: [...new Set(affected.map(featureOf))].filter(f => f !== featureOf(path)),
  }
}

// The memory key for a path as the session names it (absolute, or relative to a subfolder): the file it ends with
export function memoryKey(files: Files, path: string) {
  const p = path.replace(/\\/g, '/')
  if (files[p]) return p
  return Object.keys(files).find(k => p.endsWith(`/${k}`) || k.endsWith(`/${p}`)) ?? ''
}

// The memory as Claude reads it each turn: the features, their files and how they connect, cut to `max` characters
export function memoryText(files: Files, max = 2600) {
  const fs = features(files)
  const lines = [
    `Cockpit's map of this repository (from imports): ${Object.keys(files).length} source files in ${fs.length} features. Before changing a file, check what imports it; a change reaches those files too.`,
    ...fs.map(f => `- ${f.name} (${f.files.length} ${f.files.length === 1 ? 'file' : 'files'}: ${f.files.map(x => x.split('/').pop()).slice(0, 8).join(', ')}${f.files.length > 8 ? ', …' : ''})${f.uses.length ? `; uses ${f.uses.join(', ')}` : ''}${f.usedBy.length ? `; used by ${f.usedBy.join(', ')}` : ''}`),
  ]
  let out = ''
  for (const l of lines) {
    if (out.length + l.length + 1 > max) return `${out}- …`
    out += `${l}\n`
  }
  return out.trimEnd()
}

// The memory as a page for people: .cockpit/MEMORY.md
export function memoryMarkdown(files: Files, when: string) {
  const by = importers(files)
  const fs = features(files)
  const out = [`# Codebase memory`, ``, `Written by Cockpit from the imports of ${Object.keys(files).length} source files, ${when}. It is rebuilt at each session start and updated after each edit.`, ``]
  for (const f of fs) {
    out.push(`## ${f.name}`, ``)
    if (f.uses.length) out.push(`Uses: ${f.uses.join(', ')}  `)
    if (f.usedBy.length) out.push(`Used by: ${f.usedBy.join(', ')}  `)
    out.push(``)
    for (const file of f.files.sort()) {
      const uses = (files[file] ?? []).map(x => `\`${x}\``).join(', ')
      const usedBy = (by[file] ?? []).map(x => `\`${x}\``).join(', ')
      out.push(`- \`${file}\`${uses ? `, imports ${uses}` : ''}${usedBy ? `; imported by ${usedBy}` : ''}`)
    }
    out.push(``)
  }
  return out.join('\n')
}
