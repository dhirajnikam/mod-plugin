import type { FileOp } from '../../types'

// A path as the tree shows it: forward slashes, the root stripped only as a prefix
export function relTo(root: string) {
  const r = root.replace(/\\/g, '/').replace(/\/?$/, '/')
  return (p: string) => {
    const q = p.replace(/\\/g, '/')
    return q.startsWith(r) ? q.slice(r.length) : q
  }
}

type TreeRow = { path: string; isDir: boolean; name: string; depth: number; tag: string; op: string; touched: boolean; collapsed: boolean }
// Folder tree of the project and every path the session touched. A folder not toggled by hand is open when
// something under it was touched and folded away otherwise, so a large project stays short
export function tree(ops: FileOp[], collapsed: Record<string, boolean>, root: string, project: string[] = []): TreeRow[] {
  const rel = relTo(root)
  const files = ops.filter(o => o.op !== 'Search' && o.path)
  const isClosed = (d: string) => collapsed[d] ?? !files.some(o => rel(o.path).startsWith(`${d}/`))
  const paths = [...new Set([...project, ...files.map(o => rel(o.path))])].sort((a, b) => {
    const da = a.includes('/'), db = b.includes('/')
    return da === db ? a.localeCompare(b) : da ? -1 : 1
  })
  const rows: TreeRow[] = []
  const seen = new Set<string>()
  for (const p of paths) {
    const parts = p.split('/')
    const hidden = (i: number) => parts.slice(0, i).some((_, j) => isClosed(parts.slice(0, j + 1).join('/')))
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      if (seen.has(d)) continue
      seen.add(d)
      if (hidden(i - 1)) continue
      const touched = files.some(o => rel(o.path).startsWith(`${d}/`) && o.op !== 'Read')
      rows.push({ path: d, isDir: true, name: `${parts[i - 1]}/`, depth: i - 1, tag: '', op: '', touched, collapsed: isClosed(d) })
    }
    if (hidden(parts.length - 1)) continue
    const mine = files.filter(o => rel(o.path) === p)
    const last = mine[mine.length - 1]
    const tag = !last ? '' : last.op === 'Read' ? 'read' : last.op === 'Write' ? `new ${last.meta}` : last.op === 'Delete' ? 'deleted' : last.meta
    rows.push({ path: p, isDir: false, name: parts[parts.length - 1] ?? p, depth: parts.length - 1, tag, op: last?.op ?? '', touched: !!last && last.op !== 'Read', collapsed: false })
  }
  return rows
}
