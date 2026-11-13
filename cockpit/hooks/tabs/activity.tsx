
import type { Ph } from '../../types'
import {
  inBackground,
  buildMemory,
  set,
} from '../actions'
import {
  expertGlyph,
  fmt,
  tree,
} from '../logic'
import { featureMapSvg, features as featureList, impactOf, isTestFeature, loopUses, memberOf, memoryKey } from '../memory'
import type { FeatureMark } from '../memory'
import type { $, V } from './shared'
import { sp, Head, MapText } from './shared'

// The features and how they connect, as a diagram: what uses what, with the feature being worked on now lit, the ones
// changed this flow outlined, and the ones the last change reaches dashed. SVG where the surface draws it, else layers
// of text, each feature with the features it uses
export function workMarks(s: Ph, now: string) {
  const files = s.memory.files
  const named = s.memory.features ?? []
  const of = (p: string) => {
    const k = memoryKey(files, p)
    return k ? memberOf(files, named, k) : ''
  }
  const cur = s.flows[s.flows.length - 1]
  const marks: Record<string, FeatureMark> = {}
  const lastEdit = [...s.ops].reverse().find(o => o.op === 'Write' || o.op === 'Edit')
  const key = memoryKey(files, s.ui.treeSel || lastEdit?.path || '')
  if (key) for (const f of impactOf(files, key, 3, named).features) marks[f] = 'reached'
  for (const o of s.ops) if ((o.op === 'Write' || o.op === 'Edit' || o.op === 'Delete') && (!cur || o.at >= cur.startedAt) && of(o.path)) marks[of(o.path)] = 'touched'
  if (now && of(now)) marks[of(now)] = 'now'
  return { marks, nowFeature: now ? of(now) : '' }
}

function FeatureMap($: $, v: V, marks: Record<string, FeatureMark>) {
  const { Box, Button, Text, Svg } = v.ui
  const { s, t, w } = v
  const fs = featureList(s.memory.files, s.memory.features ?? [])
  if (fs.length < 2) return null
  // The biggest features and every marked one: a map past about twenty boxes stops being one
  const tests = fs.filter(f => isTestFeature(f))
  const shown = fs.filter(f => !isTestFeature(f)).filter((f, i) => i < 16 || marks[f.name])
  const open = !s.ui.collapsed['act-map']
  const loops = loopUses(shown)
  const legend = (
    <Text size="footnote">
      <Text color={t.busy}>■</Text>
      <Text color={t.faint}>{' now  '}</Text>
      <Text color={t.accent}>□</Text>
      <Text color={t.faint}>{' changed  '}</Text>
      {Object.values(marks).includes('reached') && <Text color={t.busy}>┅</Text>}
      {Object.values(marks).includes('reached') && <Text color={t.faint}>{' reached'}</Text>}
    </Text>
  )
  // The pane's own width, so the map is drawn at full size instead of shrunk to fit
  const width = Math.max(320, w * 8)
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" alignItems="center" columnGap={sp(v, 1)}>
        <Button key="act-map" plain onPress={() => set($, st => ({ ui: { ...st.ui, collapsed: { ...st.ui.collapsed, 'act-map': open } } }))}>
          <Text size="footnote" bold>
            <Text color={t.faint}>{open ? '⌄ ' : '› '}</Text>
            <Text color={t.dim}>FEATURE MAP</Text>
            <Text color={t.faint}>{` ${shown.length}`}</Text>
          </Text>
        </Button>
        {open && legend}
      </Box>
      {open && (Svg ? (
        <Svg source={featureMapSvg(shown, marks, { accent: t.accent, busy: t.busy, text: t.text, dim: t.dim, track: t.divider, bg: /^#/.test(t.surface) ? t.surface : s.isDarkTerm ? '#262624' : '#f5f4ef' }, width)} alt={`Feature map: ${shown.length} features`} isInteractive />
      ) : (
        <MapText v={v} nodes={shown} marks={marks} />
      ))}
      {open && (tests.length > 0 || fs.length > shown.length + tests.length || loops > 0) && (
        <Text color={t.faint} size="footnote" wrap="wrap">
          {[tests.length ? `${tests.length} test feature${tests.length === 1 ? '' : 's'} not drawn` : '', fs.length > shown.length + tests.length ? `${fs.length - shown.length - tests.length} smaller left out` : '', loops ? `↺ ${loops} use${loops === 1 ? '' : 's'} back up a loop not drawn` : ''].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Box>
  )
}

// Activity: the files touched as a tree, the one being worked on pulsing, and under it the live feed of every file
// operation and every agent's tool calls, newest first; pressing a file narrows the feed to it
// Memory: the codebase map. The features (named by a model from what each file exports, or by folder until then), each
// opening to what it does, its files and what it uses and is used by; and for the file chosen in the tree, or else the
// one edited last, the Impact: its feature, what it uses, what imports it, and every file and feature a change reaches
function Memory($: $, v: V, marks: Record<string, FeatureMark>) {
  const { Box, Button, Text } = v.ui
  const { s, t } = v
  const allFeats = !!s.ui.collapsed['act-feats']
  const m = s.memory
  const files = m.files
  const count = Object.keys(files).length
  const named = m.features ?? []
  const lastEdit = [...s.ops].reverse().find(o => o.op === 'Write' || o.op === 'Edit')
  const key = memoryKey(files, s.ui.treeSel || lastEdit?.path || '')
  const im = key ? impactOf(files, key, 3, named) : null
  const fs = featureList(files, named)
  const by: Record<string, number> = {}
  for (const imps of Object.values(files)) for (const i of imps) by[i] = (by[i] ?? 0) + 1
  const base = (f: string) => f.split('/').pop() ?? f
  const names = (xs: string[], n = 4) => (xs.length ? `${xs.slice(0, n).map(base).join(' · ')}${xs.length > n ? ` +${xs.length - n}` : ''}` : '—')
  const row = (label: string, value: string, c: string) => (
    <Text key={`im-${label}`} size="footnote" wrap="truncate-end">
      <Text color={t.faint}>{label.padEnd(9)}</Text>
      <Text color={c}>{value}</Text>
    </Text>
  )
  const state = !count ? 'mapping the codebase…' : `${count} files${m.naming ? ' · naming them…' : named.length ? '' : ' · by folder'} · mapped ${fmt(Math.max(0, v.now - m.at))} ago`
  return (
    <Box flexDirection="column" gap={v.desk ? 'md' : 1}>
      {im && (
        <Box flexDirection="column">
          <Head v={v} label="Impact" note={`${base(key)} in ${im.feature}`} {...(im.usedBy.length ? { color: t.busy } : {})} />
          {row('uses', names(im.uses), t.text)}
          {row('used by', im.usedBy.length ? names(im.usedBy) : 'nothing imports it', im.usedBy.length ? t.busy : t.ok)}
          {row('reaches', im.affected.length ? `${names(im.affected)}${im.features.length ? ` in ${im.features.join(', ')}` : ''}: check ${im.affected.length === 1 ? 'it' : 'them'}` : 'only this file', im.affected.length ? t.busy : t.ok)}
        </Box>
      )}
      <Box flexDirection="column">
      <Box justifyContent="space-between" alignItems="center" columnGap={sp(v, 1)}>
        <Button key="fold-feats" plain onPress={() => set($, st => ({ ui: { ...st.ui, collapsed: { ...st.ui.collapsed, 'act-feats': !st.ui.collapsed['act-feats'] } } }))}>
          <Text size="footnote" bold wrap="truncate-end">
            <Text color={t.faint}>{allFeats ? '⌄ ' : '› '}</Text>
            <Text color={t.dim}>FEATURES</Text>
            <Text color={t.faint}>{` ${fs.length}`}</Text>
            <Text color={t.faint} bold={false}>{`  ·  ${state}`}</Text>
          </Text>
        </Button>
        <Button key="mem-rebuild" plain onPress={() => inBackground($, 'memory', 'Mapping the codebase', () => buildMemory($, true))}>
          <Text color={t.dim} size="footnote">↻ Map again</Text>
        </Button>
      </Box>
      {(allFeats ? fs.slice(0, 24) : fs.filter(f => marks[f.name] || s.ui.openFeature === f.name)).map(f => {
        const open = s.ui.openFeature === f.name
        return (
          <Box key={`ft-${f.name}`} flexDirection="column">
            <Button key={`feat-${f.name}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openFeature: open ? '' : f.name } }))}>
              <Text wrap="truncate-end">
                <Text color={t.faint}>{open ? '▾ ' : '▸ '}</Text>
                <Text color={open ? t.accent : t.text} bold={open}>{f.name}</Text>
                <Text color={t.dim}>{`  ${f.files.length} file${f.files.length === 1 ? '' : 's'}`}</Text>
                {!open && f.what !== '' && <Text color={t.faint}>{`  ${f.what}`}</Text>}
              </Text>
            </Button>
            {open && (
              <Box flexDirection="column" paddingLeft={2}>
                {f.what !== '' && <Text color={t.text} size="footnote" wrap="wrap">{f.what}</Text>}
                {f.uses.length > 0 && row('uses', f.uses.join(', '), t.text)}
                {f.usedBy.length > 0 && row('used by', f.usedBy.join(', '), t.text)}
                {f.files.map(file => (
                  <Button key={`ff-${file}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, treeSel: st.ui.treeSel === file ? '' : file } }))}>
                    <Text size="footnote" wrap="truncate-end">
                      <Text color={t.text}>{base(file)}</Text>
                      <Text color={t.faint}>{`  ${file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''}`}</Text>
                      <Text color={t.dim}>{`  → ${(files[file] ?? []).length}  ← ${by[file] ?? 0}`}</Text>
                    </Text>
                  </Button>
                ))}
              </Box>
            )}
          </Box>
        )
      })}
      {allFeats && fs.length > 24 && <Text color={t.faint} size="footnote">{`+${fs.length - 24} more in .cockpit/MEMORY.md`}</Text>}
      </Box>
    </Box>
  )
}

export function Files($: $, v: V) {
  const { Box, Button, Text } = v.ui
  const { s, t, w } = v
  const adds = s.ops.reduce((a, o) => a + o.add, 0)
  const dels = s.ops.reduce((a, o) => a + o.del, 0)
  // As the tree has it (logic.ts tree): the root stripped only as a prefix, so the filter and the "now" mark match its rows
  const rootSlash = v.root.replace(/\\/g, '/').replace(/\/?$/, '/')
  const rel = (p: string) => {
    const q = p.replace(/\\/g, '/')
    return q.startsWith(rootSlash) ? q.slice(rootSlash.length) : q
  }
  const opGlyph = (op: string) => (op === 'Read' ? '○' : op === 'Search' ? '⌕' : op === 'Write' ? '✚' : op === 'Edit' ? '✎' : '✖')
  const opColor = (op: string) => (op === 'Write' ? t.ok : op === 'Edit' ? t.hi : op === 'Delete' ? t.bad : t.dim)
  const lineColor = (k: string): [string | undefined, string] => (k === 'a' ? ['diffAdded', t.text] : k === 'd' ? ['diffRemoved', t.text] : [undefined, t.dim])
  const diffLines = (id: string, ls: { t: string; k: string }[]) =>
    ls.map((l, i) => {
      const [bg, c] = lineColor(l.k)
      return (
        <Box key={`${id}-l${i}`} backgroundColor={bg} paddingX={1}>
          <Text color={c} mono wrap="truncate-end">{l.t}</Text>
        </Box>
      )
    })
  const running = s.agents.filter(a => a.status === 'running')
  const live = s.isWorking || running.length > 0
  // The pulse: a turning glyph, a blink, and a light that runs along a bar while work runs
  const spin = ['✻', '✼', '✽', '✾'][Math.floor(v.now / 180) % 4] ?? '✻'
  const blink = Math.floor(v.now / 400) % 2 === 0
  const marquee = () => {
    const n = Math.max(8, w - 4)
    const pos = Math.floor(v.now / 90) % (n * 2)
    const at = pos < n ? pos : n * 2 - pos - 1
    const runs: { c: string; n: number }[] = []
    for (let i = 0; i < n; i++) {
      const d = Math.abs(i - at)
      const c = d === 0 ? t.busy : d < 3 ? t.accent : d < 6 ? t.lo : t.track
      const last = runs[runs.length - 1]
      if (last && last.c === c) last.n++
      else runs.push({ c, n: 1 })
    }
    return (
      <Text mono>
        {runs.map((r, i) => (
          <Text key={`mq-${i}`} color={r.c}>{'━'.repeat(r.n)}</Text>
        ))}
      </Text>
    )
  }
  const latest = s.ops[s.ops.length - 1]
  const nowPath = live && latest && latest.op !== 'Search' ? rel(latest.path) : ''
  const rows_ = tree(s.ops, s.ui.collapsed, v.root, s.project)
  const wholeTree = !!s.ui.collapsed['act-tree']
  const filter = s.ui.treeSel
  type Row = { at: number; key: string; kind: 'op' | 'agent'; op?: (typeof s.ops)[number]; who?: string; glyph?: string; text?: string; running?: boolean }
  const feed: Row[] = [
    ...s.ops.filter(o => !filter || rel(o.path) === filter).map((o): Row => ({ at: o.at, key: `op-${o.id}`, kind: 'op', op: o })),
    ...(filter ? [] : s.agents.flatMap(a => a.log.map((l, i): Row => ({ at: l.at, key: `al-${a.id}-${i}`, kind: 'agent', who: a.name, glyph: expertGlyph(a.type), text: l.t, running: a.status === 'running' && i === a.log.length - 1 })))),
  ]
    .sort((x, y) => y.at - x.at)
    .slice(0, 80)
  const ago = (at: number) => (at ? fmt(Math.max(0, v.now - at)) : '')
  const { marks, nowFeature } = workMarks(s, live && latest && latest.op !== 'Search' ? latest.path : '')
  const doing = s.isWorking ? s.activity : running.length ? `${running.length} agent${running.length > 1 ? 's' : ''} working: ${running.map(a => a.name).join(', ')}` : s.turnStart ? 'Idle' : 'Ready'
  const edits = s.ops.filter(o => o.op === 'Write' || o.op === 'Edit' || o.op === 'Delete')
  const editFiles = new Set(edits.map(o => o.path)).size
  const state = edits.length
    ? `${edits.length} edit${edits.length === 1 ? '' : 's'} in ${editFiles} file${editFiles === 1 ? '' : 's'} this session${live ? ` · ${doing}` : ''}`
    : live ? doing : 'No edits yet this session'
  const isOpen = !!s.ui.collapsed['act-more']
  const feedRow = (r: Row, i: number) => {
    const hot = i === 0 && live && !filter
    if (r.kind === 'agent') {
      return (
        <Box key={r.key} columnGap={sp(v, 1)}>
          <Text color={r.running ? t.busy : t.faint}>{r.running && blink ? '●' : '○'}</Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={r.running ? t.busy : t.accent}>{`${r.glyph} ${r.who}  `}</Text>
              <Text color={t.text}>{r.text}</Text>
            </Text>
          </Box>
          <Text color={t.dim} size="footnote">{ago(r.at)}</Text>
        </Box>
      )
    }
    const o = r.op!
    const open = s.ui.openFile === o.id
    const name = o.op === 'Search' ? o.path : rel(o.path)
    return (
      <Box key={r.key} flexDirection="column">
        <Box columnGap={sp(v, 1)}>
          <Text color={hot && blink ? t.busy : opColor(o.op)}>{opGlyph(o.op)}</Text>
          <Box flexGrow={1} flexShrink={1}>
            <Button key={`opb-${o.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openFile: open ? '' : o.id } }))}>
              <Text color={opColor(o.op)}>{`${o.op} `}</Text>
              <Text color={hot ? t.text : i < 3 ? t.text : t.dim} wrap="truncate-end">{name}</Text>
              <Text color={t.dim}>{o.lines.length ? (open ? ' ⌄' : ' ›') : ''}</Text>
            </Button>
          </Box>
          <Box flexShrink={0} columnGap={sp(v, 1)}>
            <Text color={o.add || o.del ? (o.add >= o.del ? t.ok : t.bad) : t.dim} size="footnote">{o.add || o.del ? `+${o.add} −${o.del}` : o.meta}</Text>
            <Text color={t.dim} size="footnote">{ago(o.at)}</Text>
          </Box>
        </Box>
        {open && o.lines.length > 0 && <Box flexDirection="column" paddingLeft={2}>{diffLines(o.id, o.lines)}</Box>}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      <Text color={t.text} bold wrap="wrap">{state}</Text>
      {rows_.length === 0 && feed.length === 0 && <Text color={t.dim} wrap="wrap">No files found here yet: send a prompt, and what Claude reads, writes and runs shows here as it happens.</Text>}
      {feed.length > 0 && (
        <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Head v={v} label="Feed" {...(filter ? { note: filter } : {})} />
          {filter ? (
            <Button key="feed-all" label="show all" plain dimColor onPress={() => set($, st => ({ ui: { ...st.ui, treeSel: '' } }))} />
          ) : (
            <Text color={t.dim} size="footnote">{`${feed.length} event${feed.length === 1 ? '' : 's'} · ${s.agents.length} agent${s.agents.length === 1 ? '' : 's'}`}</Text>
          )}
        </Box>
      )}
      {feed.slice(0, filter ? feed.length : 5).map(feedRow)}
      <Button key="fold-more-activity" plain onPress={() => set($, st => ({ ui: { ...st.ui, collapsed: { ...st.ui.collapsed, 'act-more': !st.ui.collapsed['act-more'] } } }))}>
        <Text color={t.dim}>{`${isOpen ? '⌄' : '›'} More`}</Text>
      </Button>
      {isOpen && (
        <Box flexDirection="column" gap={sp(v, 1)}>
      <Box flexDirection="column" borderStyle="round" borderColor={live ? t.busy : t.divider} paddingX={1}>
        <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Text wrap="truncate-end">
            <Text color={live ? t.busy : t.dim}>{`${live ? spin : '✻'} `}</Text>
            <Text color={live ? t.text : t.dim} bold>{doing}</Text>
            {nowFeature !== '' && <Text color={t.dim}>{`  in ${nowFeature}`}</Text>}
          </Text>
          <Text size="footnote">
            {s.isWorking && <Text color={t.busy}>{`${fmt(v.now - s.turnStart)}  `}</Text>}
            {adds || dels ? (
              <Text>
                <Text color={t.ok}>{`+${adds}`}</Text>
                <Text color={t.bad}>{` −${dels}`}</Text>
              </Text>
            ) : (
              <Text color={t.dim}>no changes</Text>
            )}
          </Text>
        </Box>
        {live && marquee()}
      </Box>
      {FeatureMap($, v, marks)}
      {Memory($, v, marks)}
      {rows_.length > 0 && (
        <Box flexDirection="column">
          <Button key="fold-tree" plain onPress={() => set($, st => ({ ui: { ...st.ui, collapsed: { ...st.ui.collapsed, 'act-tree': !st.ui.collapsed['act-tree'] } } }))}>
            <Text size="footnote" bold>
              <Text color={t.faint}>{wholeTree ? '⌄ ' : '› '}</Text>
              <Text color={t.dim}>PROJECT</Text>
              <Text color={t.faint} bold={false}>{`  ${s.project.length ? `${s.project.length} files · ` : ''}${new Set(s.ops.filter(o => o.op !== 'Search').map(o => o.path)).size} touched`}</Text>
            </Text>
          </Button>
          {rows_.filter(n => wholeTree || (!n.isDir && n.touched) || (nowPath !== '' && n.path === nowPath)).map(n => {
            const isNow = nowPath !== '' && n.path === nowPath
            const chosen = filter === n.path
            const col = n.isDir ? (n.touched ? t.hi : t.dim) : n.op === 'Delete' ? t.bad : n.op === 'Write' ? t.ok : n.op === 'Edit' ? t.hi : n.op ? t.text : t.dim
            return (
              <Box key={`tree-${n.path}`} justifyContent="space-between" columnGap={sp(v, 1)}>
                <Box flexGrow={1} flexShrink={1}>
                  <Button
                    key={`treeb-${n.path}`}
                    plain
                    onPress={() => set($, st => (n.isDir ? { ui: { ...st.ui, collapsed: { ...st.ui.collapsed, [n.path]: !n.collapsed } } } : { ui: { ...st.ui, treeSel: chosen ? '' : n.path } }))}
                  >
                    <Text backgroundColor={chosen ? t.wash || undefined : undefined} mono>
                      <Text color={isNow && blink ? t.busy : t.dim}>{`${'  '.repeat(wholeTree ? n.depth : 0)}${n.isDir ? (n.collapsed ? '▸ ' : '▾ ') : isNow ? '▶ ' : `${n.op ? opGlyph(n.op) : ' '} `}`}</Text>
                      <Text color={isNow ? t.busy : col} bold={isNow || chosen} strikethrough={n.op === 'Delete'} wrap="truncate-end">
                        {wholeTree ? n.name : n.path}
                      </Text>
                    </Text>
                  </Button>
                </Box>
                <Text color={isNow ? t.busy : opColor(n.op)} size="footnote" wrap="truncate-end">{isNow ? `${n.tag} · now` : n.tag}</Text>
              </Box>
            )
          })}
        </Box>
      )}
      {!filter && feed.length > 5 && <Text color={t.dim}>{`Earlier · ${feed.length - 5} event${feed.length - 5 === 1 ? '' : 's'}`}</Text>}
      {!filter && feed.slice(5).map((r, i) => feedRow(r, i + 5))}
        </Box>
      )}
    </Box>
  )
}
