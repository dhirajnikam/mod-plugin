import type { ElementTable, EngineInterface, RenderNode } from 'claude-code'

import type { Account, Decision, GitForm, Ph, Tab, ThemeId } from '../types'
import {
  applyAccount,
  commit,
  gitInit,
  loadAccounts,
  removeAccount,
  saveAccount,
  useAccount,
  refreshRepo,
  runTester,
  set,
  setTheme,
  spawnAgent,
  stopAgent,
  subjectOf,
} from './actions'
import {
  AGENT_TYPES,
  AUTO_WHENS,
  BRANCH_PRESETS,
  GIT_OPTS,
  MSG_PRESETS,
  TYPES,
  branchName,
  commitMsg,
  fmt,
  kTok,
  progress,
  ringRuns,
  ringSvg,
  tally,
  thrOf,
  tree,
} from './logic'
import { THEMES, THEME_IDS, ctxShades } from './theme'
import type { Theme } from './theme'

type $ = EngineInterface
type T = ElementTable<'terminal'>
export type UI = Pick<T, 'Box' | 'Text' | 'Button' | 'Input' | 'Select'> & { Svg?: ElementTable<'desktop'>['Svg'] }
type V = { ui: UI; s: Ph; t: Theme; w: number; now: number; root: string }

// A thin bar: filled share in one colour, the rest as track
function Bar({ ui, w, frac, fill, track }: { ui: UI; w: number; frac: number; fill: string; track: string }) {
  const { Text } = ui
  const n = Math.max(0, Math.min(w, Math.round(frac * w)))
  return (
    <Text>
      <Text color={fill}>{'━'.repeat(n)}</Text>
      <Text color={track}>{'━'.repeat(w - n)}</Text>
    </Text>
  )
}

// Several shares side by side in one bar, track after them
function Segs({ ui, w, parts, track }: { ui: UI; w: number; parts: [number, string][]; track: string }) {
  const { Text } = ui
  let left = w
  const cells = parts.map(([frac, c], i) => {
    const n = Math.min(left, Math.round(frac * w))
    left -= n
    return <Text key={`s${i}`} color={c}>{'━'.repeat(n)}</Text>
  })
  return (
    <Text>
      {cells}
      <Text color={track}>{'━'.repeat(left)}</Text>
    </Text>
  )
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, Math.max(1, n)) : s + ' '.repeat(n - s.length))
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

// A row of choices drawn as one segmented control
function Seg<K extends string>({ v, id, items, value, onPick }: { v: V; id: string; items: [K, string][]; value: K; onPick: (k: K) => unknown }) {
  const { Box, Button, Text } = v.ui
  return (
    <Box flexWrap="wrap">
      {items.map(([k, label]) => (
        <Button key={`${id}-${k}`} plain onPress={() => onPick(k)}>
          <Text backgroundColor={k === value ? v.t.accent : v.t.track} color={k === value ? v.t.bg : v.t.dim} bold={k === value}>
            {` ${label} `}
          </Text>
        </Button>
      ))}
    </Box>
  )
}

function Check({ v, id, on, label, onPress }: { v: V; id: string; on: boolean; label: string; onPress: () => unknown }) {
  const { Button, Text } = v.ui
  return (
    <Button key={id} plain onPress={onPress}>
      <Text color={on ? v.t.accent : v.t.faint}>{on ? '▣ ' : '□ '}</Text>
      <Text color={v.t.text}>{label}</Text>
    </Button>
  )
}

const Rule = ({ v }: { v: V }) => <v.ui.Text color={v.t.divider}>{'─'.repeat(v.w)}</v.ui.Text>

export function Header($: $, v: V) {
  const { Box, Button, Text } = v.ui
  const { s, t, w } = v
  const run = s.waiting ? 'Paused · needs you' : s.isWorking ? `Running · ${fmt(v.now - s.turnStart)}` : s.turnStart ? 'Finished' : 'Idle'
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={1}>
        <Box gap={1}>
          <Text color={t.text} bold>Cockpit</Text>
          {w >= 60 && <Text color={t.dim}>a Claude Code mod</Text>}
        </Box>
        <Box gap={1} flexWrap="wrap">
          {THEME_IDS.map(id => (
            <Button key={`theme-${id}`} plain onPress={() => setTheme($, id as ThemeId)}>
              {id === 'auto' ? (
                <Text color={id === s.theme ? t.accent : t.dim}>{id === s.theme ? '[◐ auto]' : '◐'}</Text>
              ) : (
                <Text color={THEMES[id].accent} backgroundColor={THEMES[id].bg}>{id === s.theme ? '◉' : '●'}</Text>
              )}
            </Button>
          ))}
          <Text backgroundColor={t.track} color={t.dim}>{` ${run} `}</Text>
        </Box>
      </Box>
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        <Text color={t.dim}>{cut(v.root.replace(/\\/g, '/').replace(/^.*\/(?=[^/]+\/[^/]+$)/, '…/'), w)}</Text>
        <Text color={t.dim}>
          {s.repo.isRepo ? `⎇ ${s.repo.current}  ` : ''}
          {s.mode === 'auto' ? 'Auto · judge' : 'Ask mode'}
        </Text>
      </Box>
    </Box>
  )
}

export function Tabs($: $, v: V) {
  const { Box, Button, Text } = v.ui
  const { s, t } = v
  const tFail = [...s.testers.pos.cases, ...s.testers.neg.cases].filter(c => c.st === 'fail').length
  const tPass = [...s.testers.pos.cases, ...s.testers.neg.cases].filter(c => c.st !== 'fail' && c.st !== 'run').length
  const running = s.agents.filter(a => a.status === 'running').length
  const tabs: [Tab, string, string][] = [
    ['overview', 'Overview', s.waiting ? '!' : ''],
    ['files', 'Files', s.ops.length ? String(s.ops.length) : ''],
    ['tests', 'Tests', tFail ? `✗${tFail}` : tPass ? String(tPass) : ''],
    ['agents', 'Agents', running ? String(running) : ''],
    ['git', 'Git', s.repo.changed.length ? String(s.repo.changed.length) : ''],
  ]
  const total = tabs.reduce((a, [, l, b]) => a + l.length + (b ? b.length + 3 : 0) + 2, 0)
  const fits = total <= v.w
  const under = tabs.map(([id, label, badge]) => {
    const n = label.length + (badge ? badge.length + 3 : 0) + 2
    return <Text key={`u-${id}`} color={id === s.tab ? t.accent : t.divider}>{(id === s.tab ? '━' : '─').repeat(n)}</Text>
  })
  return (
    <Box flexDirection="column">
      <Box flexWrap="wrap">
        {tabs.map(([id, label, badge]) => (
          <Button key={`tab-${id}`} plain onPress={() => (id === 'git' ? Promise.all([set($, { tab: id }), refreshRepo($)]) : set($, { tab: id }))}>
            <Text color={id === s.tab ? t.text : t.dim} bold={id === s.tab} backgroundColor={!fits && id === s.tab ? t.wash : undefined}>{` ${label}`}</Text>
            {badge ? <Text backgroundColor={t.wash} color={t.deep}>{` ${badge} `}</Text> : <Text> </Text>}
            {badge ? <Text> </Text> : <Text />}
          </Button>
        ))}
      </Box>
      {fits ? (
        <Text>
          {under}
          <Text color={t.divider}>{'─'.repeat(v.w - total)}</Text>
        </Text>
      ) : (
        <Rule v={v} />
      )}
    </Box>
  )
}

export function Overview($: $, v: V) {
  const { Box, Button, Text, Svg } = v.ui
  const { s, t, w } = v
  const p = progress(s)
  const changed = s.repo.changed.length
  const needs = s.waiting ? 'Claude is waiting for your answer in the chat.' : !s.isWorking && changed ? `${changed} files ready to commit.` : ''
  const adds = s.repo.changed.reduce((a, c) => a + c.add, 0)
  const dels = s.repo.changed.reduce((a, c) => a + c.del, 0)
  const diff = adds || dels ? `+${adds} −${dels}` : '—'
  const shades = ctxShades(t)
  const used = s.ctx.used
  const win = s.ctx.window || 200000
  const decs = s.decisions.slice().reverse()
  return (
    <Box flexDirection="column" gap={1}>
      {needs !== '' && (
        <Box borderStyle="round" borderColor={t.accent} paddingX={1} justifyContent="space-between">
          <Box flexDirection="column">
            <Text color={t.hi}>NEEDS YOU</Text>
            <Text color={t.text}>{needs}</Text>
          </Box>
          {!s.waiting && <Button key="needs" label="Open Git" variant="primary" onPress={() => Promise.all([set($, { tab: 'git' }), refreshRepo($)])} />}
        </Box>
      )}
      <Box columnGap={2} flexWrap="wrap">
        {Svg ? (
          <Svg source={ringSvg(p.pct, p.stepName, { accent: t.accent, track: t.track, text: t.text, dim: t.dim })} alt={`${p.pct}% · ${p.stepName}`} width={120} height={120} />
        ) : (
          <Box flexDirection="column" flexShrink={0}>
            {ringRuns(p.pct, t.accent, t.track, t.text).map((runs, i) => (
              <Text key={`ring-${i}`}>
                {runs.map((r, j) => (
                  <Text key={`ring-${i}-${j}`} color={r.fg} backgroundColor={r.bg}>{r.t}</Text>
                ))}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column" gap={1}>
          <Text color={t.text} bold>{cut(s.task || 'No task yet: send a prompt.', w >= 48 ? w - 18 : w)}</Text>
          <Text color={t.dim}>{p.stepName}</Text>
          <Box columnGap={3} flexWrap="wrap">
            {[['Elapsed', s.isWorking ? fmt(v.now - s.turnStart) : s.lastTurnMs ? fmt(s.lastTurnMs) : '—'], ['Changes', diff], ['Cost', `$${s.cost.toFixed(2)}`]].map(([label, val]) => (
              <Box key={`st-${label}`} flexDirection="column">
                <Text color={t.dim}>{label}</Text>
                <Text color={t.text}>{val}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      <Box flexWrap="wrap" columnGap={1}>
        {p.steps.map(x => (
          <Text key={`step-${x.name}`} backgroundColor={x.st === 'active' ? t.wash : x.st === 'done' ? t.surface : t.bg} color={x.st === 'pending' ? t.dim : t.text}>
            <Text color={x.st === 'pending' ? t.faint : t.accent}>{` ${x.st === 'done' ? '✓' : x.st === 'active' ? '●' : '○'}`}</Text>
            {` ${x.name} `}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor={t.divider} paddingX={1}>
        <Box justifyContent="space-between">
          <Text color={t.text}>Context window</Text>
          <Text>
            <Text color={s.ctx.pct >= 80 ? t.hi : t.text}>{kTok(used)}</Text>
            <Text color={t.dim}>{` / ${kTok(win)}`}</Text>
          </Text>
        </Box>
        <Segs ui={v.ui} w={Math.max(10, w - 4)} track={t.track} parts={s.ctx.segs.map(([, n], i) => [n / win, shades[i] ?? t.faint])} />
        <Box flexWrap="wrap" columnGap={3}>
          {s.ctx.segs.map(([name, n], i) => (
            <Text key={`lg-${name}`}>
              <Text color={shades[i] ?? t.faint}>■ </Text>
              <Text color={t.dim}>{`${name} `}</Text>
              <Text color={t.text}>{kTok(n)}</Text>
            </Text>
          ))}
        </Box>
        <Text color={t.dim}>{s.ctx.pct >= 80 ? 'Auto-compact is about to run.' : `${kTok(Math.max(0, win - used))} free · ${s.ctx.pct}% used`}</Text>
      </Box>
      <Box flexDirection="column">
        <Box justifyContent="space-between" flexWrap="wrap">
          <Text color={t.text} bold>Decisions</Text>
          <Seg v={v} id="mode" value={s.mode} items={[['auto', 'Auto · judge'], ['ask', 'Ask me']]} onPick={k => set($, { mode: k })} />
        </Box>
        <Text color={t.dim}>Complexity 0–3 → 3 judges · 4–6 → 6 · 7–10 → 9 · two thirds to pass</Text>
        {decs.length === 0 && <Text color={t.dim}>None yet.</Text>}
        <Rule v={v} />
        {decs.map(d => {
          const tl = tally(d)
          const open = s.ui.openDec === d.id
          return (
            <Box key={`dec-${d.id}`} flexDirection="column">
              <Button key={`decb-${d.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openDec: open ? '' : d.id } }))}>
                <Text color={t.text}>{cut(d.q, Math.max(10, w - 14))}</Text>
                <Text color={t.deep}>{`  ${d.status === 'you' ? 'you' : `${d.votes.length || '…'} judges`}`}</Text>
              </Button>
              <Box justifyContent="space-between">
                <Text color={t.deep}>{d.result || (d.status === 'scoring' ? 'Scoring complexity…' : `Voting ${tl.revealed}/${tl.n}`)}</Text>
                <Text color={t.dim}>{fmt(d.at - (s.decisions[0]?.at ?? d.at))}</Text>
              </Box>
              {open && (
                <Box flexDirection="column" paddingLeft={2}>
                  <Box gap={1}>
                    <Text color={t.dim}>Complexity</Text>
                    <Bar ui={v.ui} w={Math.max(4, w - 2 - 18)} frac={d.score / 10} fill={t.accent} track={t.track} />
                    <Text color={t.text}>{`${d.score}/10`}</Text>
                  </Box>
                  <Box flexWrap="wrap" gap={1}>
                    {d.signals.map(sg => (
                      <Text key={`sig-${d.id}-${sg}`} backgroundColor={t.track} color={t.dim}>{` ${sg} `}</Text>
                    ))}
                  </Box>
                  {d.votes.length > 0 && (
                    <Box gap={1}>
                      {d.votes.map((vote, i) => (
                        <Text key={`seat-${d.id}-${i}`} color={vote < 0 ? t.faint : vote === tl.top ? t.accent : t.dim}>
                          {vote < 0 ? '◌' : vote === tl.top ? '✓' : '×'}
                        </Text>
                      ))}
                      <Text color={t.dim}>{` ${tl.yes} for · ${tl.revealed - tl.yes} against · needs ${thrOf(tl.n)}`}</Text>
                    </Box>
                  )}
                  <Text color={t.dim}>{d.opts.map((o, i) => `${i + 1}. ${o} (${tl.counts[i] ?? 0})`).join('   ')}</Text>
                </Box>
              )}
              <Rule v={v} />
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

export function Files($: $, v: V) {
  const { Box, Button, Text } = v.ui
  const { s, t, w } = v
  const adds = s.ops.reduce((a, o) => a + o.add, 0)
  const dels = s.ops.reduce((a, o) => a + o.del, 0)
  const opColor = (op: string) => (op === 'Write' || op === 'Edit' ? t.hi : op === 'Delete' ? t.dim : t.text)
  const lineColor = (k: string) => (k === 'a' ? [t.wash, t.deep] : k === 'd' ? [t.track, t.dim] : [t.bg, t.text])
  const diffLines = (id: string, ls: { t: string; k: string }[]) =>
    ls.map((l, i) => {
      const [bg, c] = lineColor(l.k)
      return <Text key={`${id}-l${i}`} backgroundColor={bg} color={c}>{pad(cut(l.t, w - 2), w - 2)}</Text>
    })
  const rows = tree(s.ops, s.ui.collapsed, v.root)
  const sel = s.ops.filter(o => o.path.replace(/\\/g, '/').endsWith(s.ui.treeSel) && s.ui.treeSel)
  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between">
        <Seg v={v} id="fview" value={s.ui.fileView} items={[['tree', 'Folders'], ['list', 'Activity']]} onPick={k => set($, st => ({ ui: { ...st.ui, fileView: k } }))} />
        <Text color={t.dim}>{adds || dels ? `+${adds} −${dels}` : 'no changes'}</Text>
      </Box>
      {s.ops.length === 0 && <Text color={t.dim}>No file operations yet.</Text>}
      {s.ui.fileView === 'tree' && rows.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.divider}>
          {rows.map(n => (
            <Button
              key={`tree-${n.path}`}
              plain
              onPress={() => set($, st => (n.isDir ? { ui: { ...st.ui, collapsed: { ...st.ui.collapsed, [n.path]: !st.ui.collapsed[n.path] } } } : { ui: { ...st.ui, treeSel: n.path } }))}
            >
              <Text backgroundColor={s.ui.treeSel === n.path ? t.wash : undefined}>
                <Text color={t.dim}>{`${'  '.repeat(n.depth)}${n.isDir ? (s.ui.collapsed[n.path] ? '▸ ' : '▾ ') : '  '}`}</Text>
                <Text color={n.isDir ? (n.touched ? t.hi : t.text) : n.op === 'Delete' ? t.faint : n.op ? t.text : t.dim} strikethrough={n.op === 'Delete'}>
                  {pad(n.name, Math.max(4, w - 6 - n.depth * 2 - n.tag.length - 3))}
                </Text>
                <Text color={opColor(n.op)}>{` ${n.tag}`}</Text>
              </Text>
            </Button>
          ))}
        </Box>
      )}
      {s.ui.fileView === 'tree' && sel.length > 0 && (
        <Box flexDirection="column">
          <Text color={t.hi}>{cut(s.ui.treeSel, w)}</Text>
          {sel
            .slice()
            .reverse()
            .map(o => (
              <Box key={`selop-${o.id}`} flexDirection="column" borderStyle="round" borderColor={t.divider}>
                <Box justifyContent="space-between">
                  <Text color={t.dim}>{`${o.op} · ${fmt(o.at - (s.ops[0]?.at ?? o.at))}`}</Text>
                  <Text color={t.dim}>{o.meta}</Text>
                </Box>
                {diffLines(o.id, o.lines)}
              </Box>
            ))}
        </Box>
      )}
      {s.ui.fileView === 'list' &&
        s.ops
          .slice()
          .reverse()
          .map(o => {
            const open = s.ui.openFile === o.id
            return (
              <Box key={`op-${o.id}`} flexDirection="column">
                <Button key={`opb-${o.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openFile: open ? '' : o.id } }))}>
                  <Text color={opColor(o.op)}>{pad(o.op, 7)}</Text>
                  <Text color={t.text}>{pad(cut(o.path.replace(/\\/g, '/').replace(v.root.replace(/\\/g, '/') + '/', ''), w - 22), w - 22)}</Text>
                  <Text color={t.dim}>{` ${pad(o.meta, Math.min(10, w - 12))} ${open ? '⌄' : '›'}`}</Text>
                </Button>
                {open && o.lines.length > 0 && <Box flexDirection="column" paddingLeft={1}>{diffLines(o.id, o.lines)}</Box>}
                <Rule v={v} />
              </Box>
            )
          })}
    </Box>
  )
}

export function Tests($: $, v: V) {
  const { Box, Button, Text } = v.ui
  const { s, t, w } = v
  const all = [...s.testers.pos.cases, ...s.testers.neg.cases]
  const pass = all.filter(c => c.st === 'pass' || c.st === 'fixed').length
  const fail = all.filter(c => c.st === 'fail').length
  const started = s.testers.pos.status !== 'idle' || s.testers.neg.status !== 'idle'
  const cards: ['pos' | 'neg', string, string, string][] = [
    ['pos', '✓', 'Positive tester', 'Proves the feature works as intended'],
    ['neg', '✗', 'Negative tester', 'Tries to break it: abuse, edge cases, bad input'],
  ]
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text color={t.text}>{started ? `${pass} of ${all.length} cases passing${fail ? ` · ${fail} failing` : ''}` : 'Testers start after a change is written'}</Text>
        <Text color={t.dim}>Two subagents: one proves it works, one tries to break it.</Text>
      </Box>
      <Check v={v} id="autotest" on={s.autoTest} label="Run both testers when a turn changes files" onPress={() => set($, st => ({ autoTest: !st.autoTest }))} />
      {cards.map(([key, icon, name, desc]) => {
        const tz = s.testers[key]
        const f = tz.cases.filter(c => c.st === 'fail').length
        const p = tz.cases.length - f
        const count = tz.status === 'idle' ? 'not started' : tz.status === 'running' ? `running · ${fmt(v.now - (tz.startedAt ?? v.now))}` : tz.status === 'error' ? 'could not start' : `${p}/${tz.cases.length} passed${f ? ` · ${f} failing` : ''}`
        const segW = tz.cases.length ? Math.max(1, Math.floor((w - 4 - tz.cases.length) / tz.cases.length)) : 0
        return (
          <Box key={`tz-${key}`} flexDirection="column" borderStyle="round" borderColor={f ? t.text : t.divider} paddingX={1}>
            <Box justifyContent="space-between">
              <Box flexDirection="column">
                <Text color={t.text}>{`${icon} ${name}`}</Text>
                <Text color={t.dim}>{desc}</Text>
              </Box>
              <Text color={t.text}>{count}</Text>
            </Box>
            {tz.cases.length > 0 && (
              <Text>
                {tz.cases.map((c, i) => (
                  <Text key={`cb-${key}-${i}`} color={c.st === 'fail' ? t.text : t.accent}>{`${'━'.repeat(segW)} `}</Text>
                ))}
              </Text>
            )}
            {tz.status === 'running' && <Bar ui={v.ui} w={w - 4} frac={((v.now / 400) % 10) / 10} fill={t.lo} track={t.track} />}
            {tz.cases.map((c, i) => (
              <Box key={`case-${key}-${i}`} flexDirection="column">
                <Text>
                  <Text color={c.st === 'fail' ? t.text : t.hi}>{c.st === 'fail' ? '✗ ' : c.st === 'fixed' ? '↻ ' : '✓ '}</Text>
                  <Text color={t.text}>{c.n}</Text>
                </Text>
                {c.err && <Text color={t.dim}>{`   ${c.err}`}</Text>}
              </Box>
            ))}
            {tz.note && <Text color={t.dim}>{tz.note}</Text>}
            <Box>
              <Button key={`rerun-${key}`} label={tz.status === 'idle' ? '▶ Run' : '↻ Re-run'} onPress={() => (tz.status === 'running' ? undefined : runTester($, key))} />
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export function Agents($: $, v: V) {
  const { Box, Button, Input, Select, Text } = v.ui
  const { s, t, w } = v
  const run = s.agents.filter(a => a.status === 'running').length
  const done = s.agents.filter(a => a.status === 'done').length
  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between">
        <Text color={t.text}>{`${run} running · ${done} done · ${s.agents.length} total`}</Text>
        <Button key="spawn-toggle" label="+ New agent" onPress={() => set($, st => ({ ui: { ...st.ui, spawnOpen: !st.ui.spawnOpen } }))} />
      </Box>
      {s.ui.spawnOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
          <Input
            key="spawn-task"
            label="Task"
            placeholder="Document the 429 response in the API guide"
            value={s.ui.spawnTask}
            onInput={val => set($, st => ({ ui: { ...st.ui, spawnTask: val } }))}
            onSubmit={val => val.trim() && spawnAgent($, val.trim(), s.ui.spawnType)}
          />
          <Box gap={2}>
            <Select key="spawn-type" label="Type" value={s.ui.spawnType} options={AGENT_TYPES.map(a => ({ value: a, label: a }))} onSelect={val => set($, st => ({ ui: { ...st.ui, spawnType: val } }))} />
            <Button key="spawn-go" label="Start" variant="primary" onPress={() => (s.ui.spawnTask.trim() ? spawnAgent($, s.ui.spawnTask.trim(), s.ui.spawnType) : undefined)} />
          </Box>
        </Box>
      )}
      {s.agents.length === 0 && <Text color={t.dim}>No subagents yet. Testers, judges' work and agents Claude starts show here.</Text>}
      {s.agents
        .slice()
        .reverse()
        .map(a => {
          const open = s.ui.openAgent === a.id
          const live = a.status === 'running'
          const took = (a.endedAt ?? v.now) - a.startedAt
          return (
            <Box key={`ag-${a.id}`} flexDirection="column" borderStyle="round" borderColor={live ? t.accent : t.divider} paddingX={1}>
              <Button key={`agb-${a.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openAgent: open ? '' : a.id } }))}>
                <Text color={live ? t.accent : a.status === 'done' ? t.lo : t.faint}>● </Text>
                <Text color={t.text}>{a.name}</Text>
                <Text color={t.dim}>{a.type !== a.name ? `  ${a.type}  ` : '  '}</Text>
                <Text color={live ? t.deep : t.dim}>{`[${{ running: 'Running', done: 'Done', stopped: 'Stopped', failed: 'Failed' }[a.status]}] ${open ? '⌄' : '›'}`}</Text>
              </Button>
              <Text color={t.dim}>{cut(a.task, w * 2)}</Text>
              {live ? <Bar ui={v.ui} w={w - 4} frac={((v.now / 400) % 10) / 10} fill={t.accent} track={t.track} /> : <Bar ui={v.ui} w={w - 4} frac={1} fill={a.status === 'done' ? t.accent : t.dim} track={t.track} />}
              <Box justifyContent="space-between">
                <Text color={t.dim}>{`${a.tools} tool calls · ${fmt(took)}`}</Text>
                <Box gap={1}>
                  <Button key={`view-${a.id}`} label="View" plain onPress={() => $.ui.view({ agentId: a.id })} />
                  {live && <Button key={`stop-${a.id}`} label="Stop" plain onPress={() => stopAgent($, a.id)} />}
                  <Button key={`restart-${a.id}`} label="Restart" plain onPress={() => spawnAgent($, a.prompt, a.type.startsWith('Tester') ? 'general-purpose' : a.type)} />
                </Box>
              </Box>
              {open && (
                <Box flexDirection="column">
                  {a.log.length === 0 && <Text color={t.dim}>No output yet.</Text>}
                  {a.log.slice(-12).map((l, i) => (
                    <Text key={`log-${a.id}-${i}`}>
                      <Text color={t.dim}>{`${fmt(l.at - a.startedAt)}  `}</Text>
                      <Text color={t.text}>{cut(l.t, w - 12)}</Text>
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          )
        })}
    </Box>
  )
}

export function Git($: $, v: V) {
  const { Box, Button, Input, Select, Text } = v.ui
  const { s, t, w } = v
  const g = s.git
  const setGit = (patch: Partial<GitForm>) => set($, st => ({ git: { ...st.git, ...patch } }))
  if (!s.repo.isRepo) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={t.dim}>This folder is not a git repository.</Text>
        <Box>
          <Button key="git-init" label="git init" variant="primary" onPress={() => gitInit($)} />
          <Button key="git-refresh" label="Refresh" onPress={() => refreshRepo($)} />
        </Box>
      </Box>
    )
  }
  // What a commit now would use: the typed subject, else the task's first line
  const subject = g.subject.trim() || subjectOf(s.task)
  const br = branchName({ ...g, subject }, s.repo.current)
  const msg = subject ? commitMsg({ ...g, subject }, br) : 'Write a subject, or send a prompt first'
  const base = g.base || s.repo.current
  const bases = [...new Set([base, ...s.repo.branches])].filter(Boolean)
  const staged = s.repo.changed.filter(c => s.staged[c.path] !== false).length
  const allOn = staged === s.repo.changed.length
  const summary = [s.accounts.find(a => a.id === s.accountId)?.label ?? '', `${staged} of ${s.repo.changed.length} files`, g.preTest && 'tests first', g.push && 'push', g.pr && `${g.draft ? 'draft PR' : 'PR'} → ${base}`, g.autoCommit && `auto ${AUTO_WHENS.find(a => a.v === g.autoWhen)?.label ?? AUTO_WHENS[1]?.label}`].filter(Boolean).join(' · ')
  const acct = s.accounts.find(a => a.id === s.accountId)
  const f = s.ui.acct
  const setForm = (patch: Partial<Account>) => set($, st => ({ ui: { ...st.ui, acct: { ...st.ui.acct, ...patch } } }))
  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between" flexWrap="wrap">
        <Text color={t.dim}>{`⎇ ${s.repo.current || '(no branch)'}${s.repo.ahead ? `  ↑${s.repo.ahead}` : ''}`}</Text>
        <Button key="git-refresh" label="↻ Refresh" plain onPress={() => refreshRepo($)} />
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor={t.divider} paddingX={1}>
        <Box justifyContent="space-between" flexWrap="wrap">
          <Text color={t.text}>Account</Text>
          <Box gap={1}>
            <Button key="acct-detect" label="Detect" plain onPress={() => loadAccounts($)} />
            <Button key="acct-add" label="+ Add" plain onPress={() => set($, st => ({ ui: { ...st.ui, acctOpen: !st.ui.acctOpen } }))} />
          </Box>
        </Box>
        {s.accounts.length === 0 && <Text color={t.dim}>No git identity found. Add one, or press Detect.</Text>}
        {s.accounts.length > 0 && <Seg v={v} id="acct" value={s.accountId} items={s.accounts.map(a => [a.id, a.label] as [string, string])} onPick={k => useAccount($, k)} />}
        {acct && (
          <Box justifyContent="space-between" flexWrap="wrap">
            <Text color={t.dim}>{cut(`${acct.name} <${acct.email}>${acct.gh ? ` · gh ${acct.gh}` : ''}`, w - 4)}</Text>
            <Box gap={1} flexWrap="wrap">
              <Button key="acct-apply" label="Use for this repo" plain onPress={() => applyAccount($)} />
              <Button key="acct-edit" label="Edit" plain onPress={() => set($, st => ({ ui: { ...st.ui, acctOpen: true, acct } }))} />
              <Button key="acct-remove" label="Remove" plain onPress={() => removeAccount($, acct.id)} />
            </Box>
          </Box>
        )}
        {s.ui.acctOpen && (
          <Box flexDirection="column">
            <Box columnGap={2} flexWrap="wrap">
              <Input key="acct-label" label="Label" placeholder="Work" value={f.label} onInput={val => setForm({ label: val })} onSubmit={val => setForm({ label: val })} />
              <Input key="acct-gh" label="GitHub login" placeholder="octocat" value={f.gh} onInput={val => setForm({ gh: val })} onSubmit={val => setForm({ gh: val })} />
            </Box>
            <Box columnGap={2} flexWrap="wrap">
              <Input key="acct-name" label="Name" value={f.name} onInput={val => setForm({ name: val })} onSubmit={val => setForm({ name: val })} />
              <Input key="acct-email" label="Email" value={f.email} onInput={val => setForm({ email: val })} onSubmit={val => setForm({ email: val })} />
            </Box>
            <Box gap={1}>
              <Button key="acct-save" label="Save account" variant="primary" onPress={() => saveAccount($, s.ui.acct)} />
              <Button key="acct-cancel" label="Cancel" onPress={() => set($, st => ({ ui: { ...st.ui, acctOpen: false } }))} />
            </Box>
          </Box>
        )}
      </Box>
      <Box columnGap={2} flexWrap="wrap">
        <Input key="git-branch" label="Branch" placeholder={s.repo.current} value={g.branchAuto ? br : g.branch || s.repo.current} onInput={val => setGit({ branch: val === s.repo.current ? '' : val, branchAuto: false })} onSubmit={val => setGit({ branch: val === s.repo.current ? '' : val, branchAuto: false })} />
        {bases.length > 0 && <Select key="git-base" label="Into" value={base} options={bases.map(b => ({ value: b }))} onSelect={val => setGit({ base: val })} />}
      </Box>
      <Seg v={v} id="ctype" value={g.type} items={TYPES.map(x => [x, x] as [string, string])} onPick={k => setGit({ type: k })} />
      <Input key="git-scope" label="Scope" value={g.scope} onInput={val => setGit({ scope: val })} onSubmit={val => setGit({ scope: val })} />
      <Input key="git-subject" label="Subject" placeholder={subjectOf(s.task) || 'what this commit does'} value={g.subject} onInput={val => setGit({ subject: val })} onSubmit={val => setGit({ subject: val })} />
      <Box borderStyle="round" borderColor={t.lo} paddingX={1} flexDirection="column">
        <Text color={subject ? t.text : t.dim}>{msg}</Text>
        {g.body !== '' && <Text color={t.dim}>{g.body}</Text>}
      </Box>
      <Box flexDirection="column">
        {s.repo.changed.length === 0 && <Text color={t.dim}>Nothing uncommitted.</Text>}
        {s.repo.changed.length > 1 && (
          <Button key="stage-all" plain onPress={() => set($, { staged: allOn ? Object.fromEntries(s.repo.changed.map(c => [c.path, false])) : {} })}>
            <Text color={t.dim}>{allOn ? '▣ Untick all' : '□ Tick all'}</Text>
          </Button>
        )}
        {s.repo.changed.map(c => (
          <Button key={`stage-${c.path}`} plain onPress={() => set($, st => ({ staged: { ...st.staged, [c.path]: st.staged[c.path] === false } }))}>
            <Text color={s.staged[c.path] !== false ? t.accent : t.faint}>{s.staged[c.path] !== false ? '▣ ' : '□ '}</Text>
            <Text color={t.text}>{pad(cut(c.path, w - 16), w - 16)}</Text>
            <Text color={t.dim}>{` ${c.meta}`}</Text>
          </Button>
        ))}
      </Box>
      <Box borderStyle="round" borderColor={t.divider} paddingX={1} columnGap={2} flexWrap="wrap">
        <Check v={v} id="git-auto" on={g.autoCommit} label="Auto-commit" onPress={() => setGit({ autoCommit: !g.autoCommit })} />
        {g.autoCommit && <Select key="git-when" value={g.autoWhen} options={AUTO_WHENS.map(a => ({ value: a.v, label: a.label }))} onSelect={val => setGit({ autoWhen: val as GitForm['autoWhen'] })} />}
      </Box>
      <Box flexDirection="column" alignItems="center">
        <Button key="git-commit" label={g.push ? 'Commit & push' : 'Commit'} variant="primary" onPress={() => commit($, false)} />
        <Text color={t.dim}>{summary}</Text>
      </Box>
      <Button key="git-more" plain onPress={() => set($, st => ({ ui: { ...st.ui, more: !st.ui.more } }))}>
        <Text color={t.dim}>{pad('Patterns & options', w - 2)}</Text>
        <Text color={t.dim}>{s.ui.more ? '⌄' : '›'}</Text>
      </Button>
      {s.ui.more && (
        <Box flexDirection="column" gap={1}>
          <Box columnGap={2} flexWrap="wrap">
            <Select key="git-bp" label="Branch pattern" value={BRANCH_PRESETS.some(p => p.v === g.branchPattern) ? g.branchPattern : g.branchPattern} options={[...BRANCH_PRESETS, ...(BRANCH_PRESETS.some(p => p.v === g.branchPattern) ? [] : [{ v: g.branchPattern, label: 'Custom' }])].map(p => ({ value: p.v, label: p.label }))} onSelect={val => setGit({ branchPattern: val, branchAuto: true })} />
            <Select key="git-mp" label="Message pattern" value={g.msgPattern} options={[...MSG_PRESETS, ...(MSG_PRESETS.some(p => p.v === g.msgPattern) ? [] : [{ v: g.msgPattern, label: 'Custom' }])].map(p => ({ value: p.v, label: p.label }))} onSelect={val => setGit({ msgPattern: val })} />
          </Box>
          <Input key="git-bpat" label="{type} {ticket} {slug} {user} {scope}" value={g.branchPattern} onInput={val => setGit({ branchPattern: val, branchAuto: true })} onSubmit={val => setGit({ branchPattern: val, branchAuto: true })} />
          <Input key="git-mpat" label="{type} {scope} {subject} {Subject} {ticket} {branch}" value={g.msgPattern} onInput={val => setGit({ msgPattern: val })} onSubmit={val => setGit({ msgPattern: val })} />
          <Box columnGap={2} flexWrap="wrap">
            <Input key="git-ticket" label="Ticket" value={g.ticket} onInput={val => setGit({ ticket: val })} onSubmit={val => setGit({ ticket: val })} />
            <Input key="git-user" label="User" value={g.user} onInput={val => setGit({ user: val })} onSubmit={val => setGit({ user: val })} />
          </Box>
          <Input key="git-body" label="Body" rows={2} value={g.body} onInput={val => setGit({ body: val })} onSubmit={val => setGit({ body: val })} />
          <Box flexWrap="wrap" columnGap={3}>
            {GIT_OPTS.map(([key, label]) => (
              <Check key={`opt-${key}`} v={v} id={`opt-${key}`} on={!!g[key]} label={label} onPress={() => setGit({ [key]: !g[key] } as Partial<GitForm>)} />
            ))}
          </Box>
        </Box>
      )}
      {s.commits.length > 0 && (
        <Box flexDirection="column">
          <Rule v={v} />
          {s.commits.map(c => (
            <Box key={`cm-${c.sha}`} flexDirection="column">
              <Text>
                <Text color={t.hi}>{c.sha}</Text>
                <Text color={t.text}>{` ${c.msg}`}</Text>
              </Text>
              <Text color={t.dim}>{c.meta}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

export type { V }

// A card in the chat, as the design draws tool activity: icon, text, figures on the right
export function Card({ ui, t, w, id, dashed, icon, left, right, onPress }: { ui: UI; t: Theme; w: number; id: string; dashed: boolean; icon: string; left: RenderNode | RenderNode[]; right: string; onPress: () => unknown }) {
  const { Box, Button, Text } = ui
  return (
    <Box borderStyle={dashed ? 'dashed' : 'round'} borderColor={t.lo} paddingX={1} width={w}>
      <Button key={`card-${id}`} plain onPress={onPress}>
        <Text color={t.hi}>{`${icon} `}</Text>
        {left}
        <Text color={t.hi}>{`  ${right}`}</Text>
      </Button>
    </Box>
  )
}

// Seats as dots: filled for the winning option, hollow for the rest, faint while voting
export function seatDots(ui: UI, t: Theme, d: Decision) {
  const { Text } = ui
  const top = tally(d).top
  return d.votes.map((v, i) => (
    <Text key={`dot-${d.id}-${i}`} color={v < 0 ? t.faint : v === top ? t.accent : t.dim}>{v < 0 || v !== top ? '○' : '●'}</Text>
  ))
}

// The testers' results above the prompt, as the design's chat card shows them
export function TesterCard($: $, ui: UI, t: Theme, s: Ph, now: number) {
  const { Box, Button, Text } = ui
  const rows: ['pos' | 'neg', string, string][] = [['pos', '✓', 'Positive tester'], ['neg', '✗', 'Negative tester']]
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
      {rows.map(([key, icon, name]) => {
        const tz = s.testers[key]
        const f = tz.cases.filter(c => c.st === 'fail').length
        const status = tz.status === 'idle' ? 'not run' : tz.status === 'running' ? `running · ${fmt(now - (tz.startedAt ?? now))}` : tz.status === 'error' ? 'could not start' : `${tz.cases.length - f}/${tz.cases.length} passed${f ? ` · ${f} failing` : ''}`
        return (
          <Button key={`tcard-${key}`} plain onPress={() => set($, { tab: 'tests' })}>
            <Text color={f ? t.text : t.hi}>{`${icon} `}</Text>
            <Text color={t.text}>{name}</Text>
            <Text color={f ? t.text : t.deep}>{`   ${status}`}</Text>
          </Button>
        )
      })}
      <Button key="tcard-hide" label="Hide" plain dimColor onPress={() => set($, st => ({ ui: { ...st.ui, testsHidden: true } }))} />
    </Box>
  )
}
