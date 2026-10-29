import type { ElementTable, EngineInterface, RenderNode } from 'claude-code'

import type { Account, Decision, GitForm, Ph, Tab, ThemeId } from '../types'
import {
  applyAccount,
  commit,
  confirmPending,
  discoverAgentTypes,
  runExpert,
  ghLoginToken,
  ghLoginWeb,
  planCommit,
  pushNow,
  skipPending,
  gitInit,
  loadAccounts,
  removeAccount,
  useAccount,
  refreshRepo,
  set,
  startPipeline,
  setTheme,
  spawnAgent,
  stopAgent,
} from './actions'
import {
  AGENT_TYPES,
  AUTO_WHENS,
  BRANCH_PRESETS,
  COMMIT_MODES,
  EXPERTS,
  PIPELINES,
  STEPS,
  expertGlyph,
  expertName,
  verifyState,
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
import { setGit as setGitPref } from './actions'
import { BAD, BUSY, OK, THEMES, THEME_IDS, ctxShades } from './theme'
import type { Theme } from './theme'

type $ = EngineInterface
type T = ElementTable<'terminal'>
export type UI = Pick<T, 'Box' | 'Text' | 'Button' | 'Input' | 'Select'> & { Svg?: ElementTable<'desktop'>['Svg'] }
// Spacing: cells on the terminal, the surface's own steps on a graphical one
const sp = (v: V, n: number) => (v.desk ? (n >= 3 ? 'lg' : n === 2 ? 'md' : 'sm') : n)

// desk: a graphical surface, whose native buttons draw their label in their own colour, so coloured marks sit beside them
type V = { ui: UI; s: Ph; t: Theme; w: number; now: number; root: string; desk: boolean }

// A thin bar: filled share in one colour, the rest as track
function Bar({ ui, w, frac, fill, track }: { ui: UI; w: number; frac: number; fill: string; track: string }) {
  const { Text } = ui
  const n = Math.max(0, Math.min(w, Math.round(frac * w)))
  return (
    <Text mono>
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
    <Text mono>
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
      {items.map(([k, label]) =>
        v.desk ? (
          <Button key={`${id}-${k}`} label={label} variant={k === value ? 'primary' : 'secondary'} onPress={() => onPick(k)} />
        ) : (
          <Button key={`${id}-${k}`} plain onPress={() => onPick(k)}>
            <Text backgroundColor={k === value ? v.t.accent : v.t.track} color={k === value ? v.t.bg || 'inverseText' : v.t.dim} bold={k === value}>
              {` ${label} `}
            </Text>
          </Button>
        ),
      )}
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

const Rule = ({ v }: { v: V }) => <v.ui.Text color={v.t.divider} mono>{'─'.repeat(v.w)}</v.ui.Text>

export function Header($: $, v: V) {
  const { Box, Button, Select, Text } = v.ui
  const { s, t, w } = v
  const run = s.waiting ? 'Paused · needs you' : s.isWorking ? `Running · ${fmt(v.now - s.turnStart)}` : s.turnStart ? 'Finished' : 'Idle'
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
        <Box gap={sp(v, 1)}>
          <Text color={t.accent} bold size="heading">Cockpit</Text>
          {w >= 60 && <Text color={t.dim} size="footnote">a Claude Code mod</Text>}
        </Box>
        <Box gap={sp(v, 1)} flexWrap="wrap">
          {v.desk ? (
            <Select key="theme" value={s.theme} options={THEME_IDS.map(id => ({ value: id, label: id === 'auto' ? '◐ auto' : `● ${id}` }))} onSelect={val => setTheme($, val as ThemeId)} />
          ) : (
            THEME_IDS.map(id => (
              <Button key={`theme-${id}`} plain onPress={() => setTheme($, id as ThemeId)}>
                {id === 'auto' ? (
                  <Text color={id === s.theme ? t.accent : t.dim}>{id === s.theme ? '[◐ auto]' : '◐'}</Text>
                ) : (
                  <Text color={THEMES[id].accent} backgroundColor={THEMES[id].bg}>{id === s.theme ? '◉' : '●'}</Text>
                )}
              </Button>
            ))
          )}
          <Text backgroundColor={t.track} color={s.waiting ? BUSY : s.isWorking ? t.accent : t.text}>{` ${run} `}</Text>
        </Box>
      </Box>
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 2)}>
        <Text color={t.dim} wrap="truncate-start">{v.root.replace(/\\/g, '/').replace(/^.*\/(?=[^/]+\/[^/]+$)/, '…/')}</Text>
        <Text>
          <Text color={t.accent}>{s.repo.isRepo ? `⎇ ${s.repo.current}  ` : ''}</Text>
          <Text color={t.dim}>{s.mode === 'auto' ? 'Auto · judge' : 'Ask mode'}</Text>
        </Text>
      </Box>
    </Box>
  )
}

export function Tabs($: $, v: V) {
  const { Box, Button, Text } = v.ui
  const { s, t } = v
  const vs = verifyState(s.agents)
  const running = s.agents.filter(a => a.status === 'running').length
  const tabs: [Tab, string, string][] = [
    ['overview', 'Overview', s.waiting ? '!' : ''],
    ['files', 'Activity', s.ops.length ? String(s.ops.length) : ''],
    ['agents', 'Agents', running ? String(running) : vs.fail ? `✗${vs.fail}` : ''],
    ['git', 'Git', s.repo.changed.length ? String(s.repo.changed.length) : ''],
  ]
  // The underline follows the tab row: each tab's width, and the one-cell gap between tabs
  const total = tabs.reduce((a, [, l, b]) => a + l.length + (b ? b.length + 3 : 0) + 2, 0) + tabs.length - 1
  const fits = total <= v.w
  const under = tabs.map(([id, label, badge], i) => {
    const n = label.length + (badge ? badge.length + 3 : 0) + 2
    return (
      <Text key={`u-${id}`} color={id === s.tab ? t.accent : t.divider}>
        {(id === s.tab ? '━' : '─').repeat(n)}
        {i < tabs.length - 1 && <Text color={t.divider}>─</Text>}
      </Text>
    )
  })
  return (
    <Box flexDirection="column">
      <Box flexWrap="wrap" columnGap={sp(v, 1)} rowGap={v.desk ? 'xs' : 0}>
        {tabs.map(([id, label, badge]) => {
          const open = () => Promise.all([set($, { tab: id }), id === 'git' ? refreshRepo($) : id === 'agents' ? discoverAgentTypes($) : null])
          return v.desk ? (
            <Button key={`tab-${id}`} label={badge ? `${label} ${badge}` : label} variant={id === s.tab ? 'primary' : 'secondary'} onPress={open} />
          ) : (
            <Button key={`tab-${id}`} plain onPress={open}>
              <Text color={id === s.tab ? t.text : t.dim} bold={id === s.tab} backgroundColor={!fits && id === s.tab ? t.wash : undefined}>{` ${label}`}</Text>
              {badge ? <Text backgroundColor={t.wash} color={t.deep}>{` ${badge} `}</Text> : <Text> </Text>}
              {badge ? <Text> </Text> : <Text />}
            </Button>
          )
        })}
      </Box>
      {fits && !v.desk ? (
        <Text mono>
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
  const needs = s.waiting ? 'Claude is waiting for your answer in the chat.' : s.pending ? `Commit "${s.pending.msg}" → ${s.pending.branch}?` : !s.isWorking && changed ? `${changed} files ready to commit.` : ''
  const adds = s.repo.changed.reduce((a, c) => a + c.add, 0)
  const dels = s.repo.changed.reduce((a, c) => a + c.del, 0)
  const diff = adds || dels ? `+${adds} −${dels}` : '—'
  const shades = ctxShades(t)
  const used = s.ctx.used
  const win = s.ctx.window || 200000
  const decs = s.decisions.slice().reverse()
  const flows = s.flows.slice().reverse()
  const totals = s.flows.reduce((a, f) => ({ ms: a.ms + ((f.endedAt ?? v.now) - f.startedAt), add: a.add + f.add, del: a.del + f.del, commits: a.commits + (f.commit ? 1 : 0) }), { ms: 0, add: 0, del: 0, commits: 0 })
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      {needs !== '' && (
        <Box borderStyle="round" borderColor={t.accent} paddingX={1} justifyContent="space-between">
          <Box flexDirection="column">
            <Text color={BUSY} bold>NEEDS YOU</Text>
            <Text color={t.text}>{needs}</Text>
          </Box>
          {s.pending ? (
            <Box gap={sp(v, 1)}>
              <Button key="needs-commit" label="Commit" variant="primary" onPress={() => confirmPending($)} />
              <Button key="needs-skip" label="Skip" onPress={() => skipPending($)} />
            </Box>
          ) : (
            !s.waiting && <Button key="needs" label="Open Git" variant="primary" onPress={() => Promise.all([set($, { tab: 'git' }), refreshRepo($)])} />
          )}
        </Box>
      )}
      <Box columnGap={sp(v, 2)} flexWrap="wrap">
        {Svg ? (
          <Svg source={ringSvg(p.pct, p.stepName, { accent: t.accent, track: t.track, text: t.text, dim: t.dim })} alt={`${p.pct}% · ${p.stepName}`} width={120} height={120} />
        ) : (
          <Box flexDirection="column" flexShrink={0}>
            {ringRuns(p.pct, t.accent, t.track, t.text).map((runs, i) => (
              <Text key={`ring-${i}`} mono>
                {runs.map((r, j) => (
                  <Text key={`ring-${i}-${j}`} color={r.fg} backgroundColor={r.bg}>{r.t}</Text>
                ))}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column" gap={sp(v, 1)} flexGrow={1} flexShrink={1}>
          <Text color={t.text} bold size="heading" wrap="wrap">{s.task || 'No task yet: send a prompt.'}</Text>
          <Text color={s.isWorking ? t.accent : t.dim}>{p.stepName}</Text>
          <Box columnGap={sp(v, 3)} flexWrap="wrap">
            {[['Elapsed', s.isWorking ? fmt(v.now - s.turnStart) : s.lastTurnMs ? fmt(s.lastTurnMs) : '—', s.isWorking ? BUSY : t.text], ['Changes', diff, adds || dels ? OK : t.dim], ['Cost', `$${s.cost.toFixed(2)}`, t.accent]].map(([label, val, c]) => (
              <Box key={`st-${label}`} flexDirection="column">
                <Text color={t.dim} size="footnote">{label}</Text>
                <Text color={c} bold>{val}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      <Box flexWrap="wrap" columnGap={sp(v, 1)}>
        {p.steps.map(x => (
          <Text key={`step-${x.name}`} backgroundColor={x.st === 'active' ? t.wash : (x.st === 'done' && t.surface) || undefined} color={x.st === 'pending' ? t.dim : x.st === 'active' ? t.hi : t.text} bold={x.st === 'active'}>
            <Text color={x.st === 'done' ? OK : x.st === 'active' ? t.accent : t.faint}>{` ${x.st === 'done' ? '✓' : x.st === 'active' ? '●' : '○'}`}</Text>
            {` ${x.name} `}
          </Text>
        ))}
      </Box>
      {flows.length > 0 && (
        <Box flexDirection="column">
          <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Text color={t.text} weight="semibold">{`Flows (${flows.length})`}</Text>
            <Text size="footnote">
              <Text color={t.dim}>{`${fmt(totals.ms)} · `}</Text>
              <Text color={OK}>{`+${totals.add}`}</Text>
              <Text color={BAD}>{` −${totals.del}`}</Text>
              <Text color={t.dim}>{` · ${totals.commits} commit${totals.commits === 1 ? '' : 's'}`}</Text>
            </Text>
          </Box>
          {flows.map(f => {
            const open = s.ui.openFlow === f.id
            const live = f.status === 'running'
            const col = live ? BUSY : f.status === 'done' ? OK : BAD
            const took = (f.endedAt ?? v.now) - f.startedAt
            return (
              <Box key={`fl-${f.id}`} flexDirection="column">
                <Box columnGap={sp(v, 1)}>
                  <Text color={col}>{live ? '●' : f.status === 'done' ? '✓' : '✕'}</Text>
                  <Text color={live ? BUSY : t.dim} size="footnote" mono>{fmt(took)}</Text>
                  <Box flexGrow={1} flexShrink={1}>
                    <Button key={`flb-${f.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openFlow: open ? '' : f.id } }))}>
                      <Text color={live ? t.text : t.text} bold={live} wrap="truncate-end">{f.task}</Text>
                    </Button>
                  </Box>
                  <Text mono>
                    {STEPS.map(name => (
                      <Text key={`fs-${f.id}-${name}`} color={f.reached.includes(name) ? (live && name === f.reached[f.reached.length - 1] ? BUSY : OK) : t.faint}>{f.reached.includes(name) ? (live && name === f.reached[f.reached.length - 1] ? '●' : '✓') : '○'}</Text>
                    ))}
                  </Text>
                  {(f.add || f.del) > 0 && (
                    <Text size="footnote">
                      <Text color={OK}>{`+${f.add}`}</Text>
                      <Text color={BAD}>{` −${f.del}`}</Text>
                    </Text>
                  )}
                  {f.commit !== '' && <Text color={t.accent} size="footnote" mono>{f.commit}</Text>}
                </Box>
                {open && (
                  <Box flexDirection="column" paddingLeft={2}>
                    <Text color={t.dim} size="footnote" wrap="wrap">{`${f.reached.join(' › ')}${f.status === 'aborted' ? ' · stopped' : ''}`}</Text>
                    <Text color={t.dim} size="footnote">{`${f.ops} file operations · ${f.decisions} decision${f.decisions === 1 ? '' : 's'}${f.commit ? ` · committed ${f.commit}` : ' · not committed'}`}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )}
      <Box flexDirection="column" borderStyle="round" borderColor={t.divider} paddingX={1}>
        <Box justifyContent="space-between">
          <Text color={t.text} weight="semibold">Context window</Text>
          <Text>
            <Text color={s.ctx.pct >= 80 ? BAD : s.ctx.pct >= 50 ? BUSY : OK}>{kTok(used)}</Text>
            <Text color={t.dim}>{` / ${kTok(win)}`}</Text>
          </Text>
        </Box>
        <Segs ui={v.ui} w={Math.max(10, w - 4)} track={t.track} parts={s.ctx.segs.map(([, n], i) => [n / win, shades[i] ?? t.faint])} />
        <Box flexWrap="wrap" columnGap={sp(v, 3)}>
          {s.ctx.segs.map(([name, n], i) => (
            <Text key={`lg-${name}`}>
              <Text color={shades[i] ?? t.faint}>■ </Text>
              <Text color={t.dim}>{`${name} `}</Text>
              <Text color={t.text}>{kTok(n)}</Text>
            </Text>
          ))}
        </Box>
        <Text color={s.ctx.pct >= 80 ? BAD : t.dim} size="footnote">{s.ctx.pct >= 80 ? 'Auto-compact is about to run.' : `${kTok(Math.max(0, win - used))} free · ${s.ctx.pct}% used`}</Text>
      </Box>
      <Box flexDirection="column">
        <Box justifyContent="space-between" flexWrap="wrap">
          <Text color={t.text} bold weight="semibold">Decisions</Text>
          <Seg v={v} id="mode" value={s.mode} items={[['auto', 'Auto · judge'], ['ask', 'Ask me']]} onPick={k => set($, { mode: k })} />
        </Box>
        <Text color={t.dim} size="footnote">Complexity 0–3 → 3 judges · 4–6 → 6 · 7–10 → 9 · two thirds to pass</Text>
        {decs.length === 0 && <Text color={t.dim}>None yet.</Text>}
        <Rule v={v} />
        {decs.map(d => {
          const tl = tally(d)
          const open = s.ui.openDec === d.id
          return (
            <Box key={`dec-${d.id}`} flexDirection="column">
              <Box justifyContent="space-between" columnGap={sp(v, 2)}>
                <Box flexGrow={1} flexShrink={1}>
                  <Button key={`decb-${d.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openDec: open ? '' : d.id } }))}>
                    <Text color={t.text} wrap="truncate-end">{d.q}</Text>
                  </Button>
                </Box>
                <Text color={d.status === 'you' ? t.dim : t.deep}>{d.status === 'you' ? 'you' : `${d.votes.length || '…'} judges`}</Text>
              </Box>
              <Box justifyContent="space-between">
                <Text color={d.status === 'decided' ? OK : d.status === 'split' ? BUSY : d.status === 'you' ? t.text : t.deep}>{d.result || (d.status === 'scoring' ? 'Scoring complexity…' : `Voting ${tl.revealed}/${tl.n}`)}</Text>
                <Text color={t.dim}>{fmt(d.at - (s.decisions[0]?.at ?? d.at))}</Text>
              </Box>
              {open && (
                <Box flexDirection="column" paddingLeft={2}>
                  <Box gap={sp(v, 1)}>
                    <Text color={t.dim}>Complexity</Text>
                    <Bar ui={v.ui} w={Math.max(4, w - 2 - 18)} frac={d.score / 10} fill={t.accent} track={t.track} />
                    <Text color={t.text}>{`${d.score}/10`}</Text>
                  </Box>
                  <Box flexWrap="wrap" gap={sp(v, 1)}>
                    {d.signals.map(sg => (
                      <Text key={`sig-${d.id}-${sg}`} backgroundColor={t.track} color={t.dim}>{` ${sg} `}</Text>
                    ))}
                  </Box>
                  {d.votes.length > 0 && (
                    <Box gap={sp(v, 1)}>
                      {d.votes.map((vote, i) => (
                        <Text key={`seat-${d.id}-${i}`} color={vote < 0 ? t.faint : vote === tl.top ? OK : BAD}>
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

// Activity: the files touched as a tree, the one being worked on pulsing, and under it the live feed of every file
// operation and every agent's tool calls, newest first; pressing a file narrows the feed to it
export function Files($: $, v: V) {
  const { Box, Button, Text } = v.ui
  const { s, t, w } = v
  const adds = s.ops.reduce((a, o) => a + o.add, 0)
  const dels = s.ops.reduce((a, o) => a + o.del, 0)
  const rel = (p: string) => p.replace(/\\/g, '/').replace(v.root.replace(/\\/g, '/') + '/', '')
  const opGlyph = (op: string) => (op === 'Read' ? '○' : op === 'Search' ? '⌕' : op === 'Write' ? '✚' : op === 'Edit' ? '✎' : '✖')
  const opColor = (op: string) => (op === 'Write' ? OK : op === 'Edit' ? t.hi : op === 'Delete' ? BAD : t.dim)
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
      const c = d === 0 ? BUSY : d < 3 ? t.accent : d < 6 ? t.lo : t.track
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
  const rows_ = tree(s.ops, s.ui.collapsed, v.root)
  const filter = s.ui.treeSel
  type Row = { at: number; key: string; kind: 'op' | 'agent'; op?: (typeof s.ops)[number]; who?: string; glyph?: string; text?: string; running?: boolean }
  const feed: Row[] = [
    ...s.ops.filter(o => !filter || rel(o.path) === filter).map((o): Row => ({ at: o.at, key: `op-${o.id}`, kind: 'op', op: o })),
    ...(filter ? [] : s.agents.flatMap(a => a.log.map((l, i): Row => ({ at: l.at, key: `al-${a.id}-${i}`, kind: 'agent', who: a.name, glyph: expertGlyph(a.type), text: l.t, running: a.status === 'running' && i === a.log.length - 1 })))),
  ]
    .sort((x, y) => y.at - x.at)
    .slice(0, 80)
  const ago = (at: number) => (at ? fmt(Math.max(0, v.now - at)) : '')
  const doing = s.isWorking ? s.activity : running.length ? `${running.length} agent${running.length > 1 ? 's' : ''} working: ${running.map(a => a.name).join(', ')}` : s.turnStart ? 'Idle' : 'Ready'
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      <Box flexDirection="column" borderStyle="round" borderColor={live ? BUSY : t.divider} paddingX={1}>
        <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Text wrap="truncate-end">
            <Text color={live ? BUSY : t.dim}>{`${live ? spin : '✻'} `}</Text>
            <Text color={live ? t.text : t.dim} bold>{doing}</Text>
          </Text>
          <Text size="footnote">
            {s.isWorking && <Text color={BUSY}>{`${fmt(v.now - s.turnStart)}  `}</Text>}
            {adds || dels ? (
              <Text>
                <Text color={OK}>{`+${adds}`}</Text>
                <Text color={BAD}>{` −${dels}`}</Text>
              </Text>
            ) : (
              <Text color={t.dim}>no changes</Text>
            )}
          </Text>
        </Box>
        {live && marquee()}
      </Box>
      {rows_.length === 0 && <Text color={t.dim} wrap="wrap">Nothing yet: send a prompt, and what Claude reads, writes and runs shows here as it happens.</Text>}
      {rows_.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.divider} paddingX={1}>
          <Box justifyContent="space-between" flexWrap="wrap">
            <Text color={t.text} weight="semibold">Files</Text>
            <Text color={t.dim} size="footnote">{`${new Set(s.ops.filter(o => o.op !== 'Search').map(o => o.path)).size} touched`}</Text>
          </Box>
          {rows_.map(n => {
            const isNow = nowPath !== '' && n.path === nowPath
            const chosen = filter === n.path
            const col = n.isDir ? (n.touched ? t.hi : t.dim) : n.op === 'Delete' ? BAD : n.op === 'Write' ? OK : n.op === 'Edit' ? t.hi : n.op ? t.text : t.dim
            return (
              <Box key={`tree-${n.path}`} justifyContent="space-between" columnGap={sp(v, 1)}>
                <Box flexGrow={1} flexShrink={1}>
                  <Button
                    key={`treeb-${n.path}`}
                    plain
                    onPress={() => set($, st => (n.isDir ? { ui: { ...st.ui, collapsed: { ...st.ui.collapsed, [n.path]: !st.ui.collapsed[n.path] } } } : { ui: { ...st.ui, treeSel: chosen ? '' : n.path } }))}
                  >
                    <Text backgroundColor={chosen ? t.wash : undefined} mono>
                      <Text color={isNow && blink ? BUSY : t.dim}>{`${'  '.repeat(n.depth)}${n.isDir ? (s.ui.collapsed[n.path] ? '▸ ' : '▾ ') : isNow ? '▶ ' : `${n.op ? opGlyph(n.op) : ' '} `}`}</Text>
                      <Text color={isNow ? BUSY : col} bold={isNow || chosen} strikethrough={n.op === 'Delete'} wrap="truncate-end">
                        {n.name}
                      </Text>
                    </Text>
                  </Button>
                </Box>
                <Text color={isNow ? BUSY : opColor(n.op)} size="footnote" wrap="truncate-end">{isNow ? `${n.tag} · now` : n.tag}</Text>
              </Box>
            )
          })}
        </Box>
      )}
      {feed.length > 0 && (
        <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Text color={t.text} weight="semibold">{filter ? `Feed · ${filter}` : 'Feed'}</Text>
          {filter ? (
            <Button key="feed-all" label="show all" plain dimColor onPress={() => set($, st => ({ ui: { ...st.ui, treeSel: '' } }))} />
          ) : (
            <Text color={t.dim} size="footnote">{`${s.ops.length} operations · ${s.agents.length} agents`}</Text>
          )}
        </Box>
      )}
      {feed.map((r, i) => {
        const hot = i === 0 && live && !filter
        if (r.kind === 'agent') {
          return (
            <Box key={r.key} columnGap={sp(v, 1)}>
              <Text color={r.running ? BUSY : t.faint}>{r.running && blink ? '●' : '○'}</Text>
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-end">
                  <Text color={r.running ? BUSY : t.accent}>{`${r.glyph} ${r.who}  `}</Text>
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
              <Text color={hot && blink ? BUSY : opColor(o.op)}>{opGlyph(o.op)}</Text>
              <Box flexGrow={1} flexShrink={1}>
                <Button key={`opb-${o.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openFile: open ? '' : o.id } }))}>
                  <Text color={opColor(o.op)}>{`${o.op} `}</Text>
                  <Text color={hot ? t.text : i < 3 ? t.text : t.dim} wrap="truncate-end">{name}</Text>
                  <Text color={t.dim}>{o.lines.length ? (open ? ' ⌄' : ' ›') : ''}</Text>
                </Button>
              </Box>
              <Text color={o.add || o.del ? (o.add >= o.del ? OK : BAD) : t.dim} size="footnote">{o.add || o.del ? `+${o.add} −${o.del}` : o.meta}</Text>
              <Text color={t.dim} size="footnote">{ago(o.at)}</Text>
            </Box>
            {open && o.lines.length > 0 && <Box flexDirection="column" paddingLeft={2}>{diffLines(o.id, o.lines)}</Box>}
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
  const types = s.agentTypes.length ? s.agentTypes : AGENT_TYPES
  const latestOf = (type: string) => s.agents.filter(a => a.type === type).pop()
  const pipe = s.pipeline
  const current = pipe ? expertName(pipe.steps[pipe.index] ?? '') : ''
  const handoff = pipe?.reports[pipe.reports.length - 1]?.split('\n').find(l => l.startsWith('HANDOFF:'))?.slice(8).trim() ?? ''
  const cardW = v.desk ? '48%' : w >= 64 ? Math.floor((w - 2) / 2) : w
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      <Box flexDirection="column" borderStyle="round" borderColor={pipe ? t.accent : t.lo} paddingX={1}>
        <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Text color={t.text} weight="semibold">Pipelines</Text>
          <Text color={pipe ? BUSY : t.dim} size="footnote">{pipe ? `running · ${fmt(v.now - pipe.at)}` : 'experts in turn, each handed the reports before it'}</Text>
        </Box>
        <Box flexWrap="wrap" columnGap={sp(v, 1)}>
          {PIPELINES.map(p => (
            <Button key={`pipe-${p.name}`} label={`▶ ${p.label}`} variant={pipe?.name === p.name ? 'primary' : 'secondary'} onPress={() => startPipeline($, p.name)} />
          ))}
          {pipe && pipe.agentId !== '' && <Button key="pipe-stop" label="■ Stop" plain onPress={() => stopAgent($, pipe.agentId)} />}
        </Box>
        {pipe ? (
          <Box flexDirection="column">
            <Text wrap="wrap">
              {pipe.steps.map((st, i) => (
                <Text key={`ps-${i}`} color={i < pipe.index ? OK : i === pipe.index ? BUSY : t.dim} bold={i === pipe.index}>
                  {`${i ? '  ›  ' : ''}${i < pipe.index ? '✓' : i === pipe.index ? '●' : '○'} ${expertName(st)}`}
                </Text>
              ))}
            </Text>
            {handoff !== '' && (
              <Text wrap="wrap">
                <Text color={t.accent}>{'↳ '}</Text>
                <Text color={t.dim}>{`to the ${current.toLowerCase()}: `}</Text>
                <Text color={t.text}>{handoff}</Text>
              </Text>
            )}
          </Box>
        ) : (
          <Text color={t.dim} size="footnote" wrap="wrap">{PIPELINES.map(p => `${p.label}: ${p.what}`).join('  ·  ')}</Text>
        )}
      </Box>
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
        <Text color={t.text} weight="semibold">Team</Text>
        <Check v={v} id="autoverify" on={s.autoVerify} label="Verify after each turn that changes files" onPress={() => set($, st => ({ autoVerify: !st.autoVerify }))} />
      </Box>
      <Box flexWrap="wrap" columnGap={sp(v, 1)} rowGap={v.desk ? 'sm' : 0}>
        {EXPERTS.map(x => {
          const a = latestOf(x.type)
          const live = a?.status === 'running'
          const fails = a?.cases.filter(c => c.st === 'fail').length ?? 0
          const col = live ? BUSY : a?.status === 'done' ? (fails ? BAD : OK) : a?.status === 'failed' ? BAD : a ? t.dim : t.faint
          const last = a?.log[a.log.length - 1]?.t
          const line = !a ? 'idle' : live ? `${last ?? 'starting'} · ${fmt(v.now - a.startedAt)}` : `${{ done: 'done', stopped: 'stopped', failed: 'failed', running: '' }[a.status]} ${fmt((a.endedAt ?? v.now) - a.startedAt)}${a.cases.length ? ` · ${a.cases.length - fails}/${a.cases.length} passed` : ''}`
          const report = a?.report.split('\n').find(l => l.startsWith('REPORT:'))?.slice(7).trim() ?? ''
          return (
            <Box key={`ex-${x.type}`} flexDirection="column" borderStyle="round" borderColor={live ? BUSY : a?.status === 'done' ? (fails ? BAD : OK) : t.divider} paddingX={1} width={cardW}>
              <Box justifyContent="space-between" columnGap={sp(v, 1)}>
                <Text>
                  <Text color={col}>{`${x.glyph} `}</Text>
                  <Text color={t.text} bold>{x.name}</Text>
                </Text>
                {live ? (
                  <Button key={`halt-${x.type}`} label="■" plain onPress={() => stopAgent($, a.id)} />
                ) : (
                  <Button key={`run-${x.type}`} label="▶" plain onPress={() => runExpert($, x.type)} />
                )}
              </Box>
              <Text color={t.dim} size="footnote" wrap="wrap">{x.what}</Text>
              <Text color={col} size="footnote" wrap="truncate-end">{live ? `● ${line}` : line}</Text>
              {report !== '' && <Text color={t.text} size="footnote" wrap="truncate-end">{report}</Text>}
              {a && <Button key={`look-${x.type}`} label="View" plain dimColor onPress={() => $.ui.view({ agentId: a.id })} />}
            </Box>
          )
        })}
      </Box>
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
        <Text weight="semibold">
          <Text color={t.text}>Activity</Text>
          <Text color={t.dim}>{'  '}</Text>
          <Text color={run ? BUSY : t.dim}>{`${run} running`}</Text>
          <Text color={t.dim}>{' · '}</Text>
          <Text color={done ? OK : t.dim}>{`${done} done`}</Text>
          <Text color={t.dim}>{` · ${s.agents.length} total`}</Text>
        </Text>
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
          <Box columnGap={sp(v, 2)} flexWrap="wrap">
            <Select key="spawn-type" label="Type" value={s.ui.spawnType} options={[...types, ...(types.includes(s.ui.spawnType) ? [] : [s.ui.spawnType])].map(a => ({ value: a, label: a }))} onSelect={val => set($, st => ({ ui: { ...st.ui, spawnType: val } }))} />
            <Input key="spawn-type-custom" label="or any type" placeholder="my-plugin:reviewer" value={types.includes(s.ui.spawnType) ? '' : s.ui.spawnType} onInput={val => val.trim() && set($, st => ({ ui: { ...st.ui, spawnType: val.trim() } }))} onSubmit={val => val.trim() && set($, st => ({ ui: { ...st.ui, spawnType: val.trim() } }))} />
            <Button key="spawn-go" label="Start" variant="primary" onPress={() => (s.ui.spawnTask.trim() ? spawnAgent($, s.ui.spawnTask.trim(), s.ui.spawnType) : undefined)} />
          </Box>
          <Text color={t.dim} size="footnote">{`${types.length} types: built-ins, the experts, agents/*.md in this project and ~/.claude, each plugin's as plugin:name`}</Text>
        </Box>
      )}
      {s.agents.length === 0 && <Text color={t.dim}>No agents yet. Experts, pipelines and the agents Claude starts show here.</Text>}
      {s.agents
        .slice()
        .reverse()
        .map(a => {
          const open = s.ui.openAgent === a.id
          const live = a.status === 'running'
          const fails = a.cases.filter(c => c.st === 'fail').length
          const stc = live ? BUSY : a.status === 'done' ? (fails ? BAD : OK) : a.status === 'failed' ? BAD : t.faint
          const took = (a.endedAt ?? v.now) - a.startedAt
          const last = a.log[a.log.length - 1]?.t
          return (
            <Box key={`ag-${a.id}`} flexDirection="column" borderStyle="round" borderColor={live ? BUSY : t.divider} paddingX={1}>
              <Box justifyContent="space-between" columnGap={sp(v, 1)}>
                <Box flexShrink={1}>
                  <Text color={stc}>{`${expertGlyph(a.type)} `}</Text>
                  <Button key={`agb-${a.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openAgent: open ? '' : a.id } }))}>
                    <Text color={t.text} bold>{a.name}</Text>
                    <Text color={t.dim}>{a.type !== a.name ? `  ${a.type}  ` : '  '}</Text>
                    <Text color={stc}>{`[${{ running: 'Running', done: 'Done', stopped: 'Stopped', failed: 'Failed' }[a.status]}] ${open ? '⌄' : '›'}`}</Text>
                  </Button>
                </Box>
                <Text color={t.dim} size="footnote">{`${a.tools} tool calls · ${fmt(took)}`}</Text>
              </Box>
              <Text color={t.dim} wrap="truncate-end">{a.task}</Text>
              {live && (
                <Text color={BUSY} size="footnote" wrap="truncate-end">{`● ${last ?? 'starting'}`}</Text>
              )}
              {live ? <Bar ui={v.ui} w={w - 4} frac={((v.now / 400) % 10) / 10} fill={BUSY} track={t.track} /> : <Bar ui={v.ui} w={w - 4} frac={1} fill={stc} track={t.track} />}
              {a.cases.length > 0 && (
                <Box flexDirection="column">
                  {a.cases.map((c, i) => (
                    <Text key={`case-${a.id}-${i}`} wrap="truncate-end">
                      <Text color={c.st === 'fail' ? BAD : c.st === 'fixed' ? BUSY : OK}>{c.st === 'fail' ? '✗ ' : c.st === 'fixed' ? '↻ ' : '✓ '}</Text>
                      <Text color={t.text}>{c.n}</Text>
                      {c.err && <Text color={t.dim}>{` · ${c.err}`}</Text>}
                    </Text>
                  ))}
                </Box>
              )}
              <Box gap={sp(v, 1)} flexWrap="wrap">
                <Button key={`view-${a.id}`} label="View" plain onPress={() => $.ui.view({ agentId: a.id })} />
                {live && <Button key={`stop-${a.id}`} label="Stop" plain onPress={() => stopAgent($, a.id)} />}
                <Button key={`restart-${a.id}`} label="Restart" plain onPress={() => spawnAgent($, a.prompt, a.type)} />
              </Box>
              {open && a.report !== '' && <Text color={t.dim} wrap="wrap">{a.report}</Text>}
              {open && (
                <Box flexDirection="column">
                  {a.log.length === 0 && <Text color={t.dim}>No output yet.</Text>}
                  {a.log.slice(-12).map((l, i) => (
                    <Text key={`log-${a.id}-${i}`}>
                      <Text color={t.dim}>{`${fmt(l.at - a.startedAt)}  `}</Text>
                      <Text color={t.text} wrap="truncate-end">{l.t}</Text>
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
  const { s, t } = v
  const g = s.git
  const setGit = (patch: Partial<GitForm>) => setGitPref($, patch)
  if (!s.repo.isRepo) {
    return (
      <Box flexDirection="column" gap={sp(v, 1)}>
        <Text color={t.dim}>This folder is not a git repository.</Text>
        <Box gap={sp(v, 1)}>
          <Button key="git-init" label="git init" variant="primary" onPress={() => gitInit($)} />
          <Button key="git-refresh" label="Refresh" onPress={() => refreshRepo($)} />
        </Box>
      </Box>
    )
  }
  if (!g.setupDone) return Setup($, v)
  const plan = planCommit(s)
  const staged = plan.files.length
  const allOn = staged === s.repo.changed.length
  const acct = s.accounts.find(a => a.id === s.accountId)
  const mode = COMMIT_MODES.find(m => m[0] === g.commitMode)?.[1] ?? 'Ask me'
  const when = g.commitMode === 'manual' ? '' : ` · ${AUTO_WHENS.find(a => a.v === g.autoWhen)?.label ?? AUTO_WHENS[0]?.label}`
  const newBranch = plan.branch !== s.repo.current
  const kindColor = (meta: string) => (meta === 'new' ? OK : meta === 'deleted' ? BAD : meta.startsWith('renamed') ? BUSY : t.hi)
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
        <Text>
          <Text color={t.accent} bold>{`⎇ ${s.repo.current || '(no branch)'}`}</Text>
          {s.repo.ahead > 0 && <Text color={BUSY}>{`  ↑${s.repo.ahead} to push`}</Text>}
          {s.repo.changed.length > 0 && <Text color={t.dim}>{`  ·  ${s.repo.changed.length} changed`}</Text>}
        </Text>
        <Box gap={sp(v, 1)} flexWrap="wrap">
          {s.repo.ahead > 0 && <Button key="git-push" label="↑ Push" plain onPress={() => pushNow($)} />}
          <Button key="git-refresh" label="↻" plain onPress={() => refreshRepo($)} />
          <Button key="git-setup" label="⚙" plain onPress={() => Promise.all([setGit({ setupDone: false }), set($, st => ({ ui: { ...st.ui, gitStep: 0 } }))])} />
        </Box>
      </Box>
      <Text color={t.dim} size="footnote" wrap="truncate-end">{`${acct ? `${acct.label} <${acct.email}>` : 'no account'}  ·  ${mode}${when}`}</Text>
      {s.pending && (
        <Box flexDirection="column" borderStyle="round" borderColor={BUSY} paddingX={1}>
          <Text color={BUSY} bold>Commit this?</Text>
          <Text color={t.hi} mono wrap="truncate-end">{s.pending.msg}</Text>
          <Text color={t.dim} size="footnote">{`→ ${s.pending.branch} · ${s.pending.files.length} files`}</Text>
          <Box gap={sp(v, 1)}>
            <Button key="pend-commit" label="Commit" variant="primary" onPress={() => confirmPending($)} />
            <Button key="pend-skip" label="Skip" onPress={() => skipPending($)} />
          </Box>
        </Box>
      )}
      <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
        <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Text color={t.text} weight="semibold">Next commit</Text>
          <Text>
            <Text color={t.deep} backgroundColor={t.wash} bold>{` ${plan.type} `}</Text>
            <Text color={t.dim} size="footnote">{g.commitMode === 'manual' ? '  your pick' : '  from the task'}</Text>
          </Text>
        </Box>
        {g.commitMode === 'manual' && <Seg v={v} id="ctype" value={g.type} items={TYPES.map(x => [x, x] as [string, string])} onPick={k => setGit({ type: k })} />}
        <Text color={plan.msg ? t.hi : t.dim} mono wrap="truncate-end">{plan.msg || 'Send a prompt, or change a file'}</Text>
        <Text size="footnote" wrap="truncate-end">
          <Text color={newBranch ? OK : t.dim}>{newBranch ? `⎇ new ${plan.branch}` : `⎇ ${plan.branch}`}</Text>
          <Text color={t.dim}>{`  ·  ${staged} of ${s.repo.changed.length} files${g.push ? '  ·  push' : ''}${g.pr ? `  ·  ${g.draft ? 'draft PR' : 'PR'} → ${g.base}` : ''}`}</Text>
        </Text>
        <Box justifyContent="flex-end">
          <Button key="git-commit" label={g.push ? 'Commit & push' : 'Commit'} variant="primary" onPress={() => commit($, false)} />
        </Box>
      </Box>
      <Box flexDirection="column">
        <Box justifyContent="space-between" flexWrap="wrap">
          <Text color={t.text} weight="semibold">{`Changes${s.repo.changed.length ? ` (${s.repo.changed.length})` : ''}`}</Text>
          {s.repo.changed.length > 1 && (
            <Button key="stage-all" plain onPress={() => set($, { staged: allOn ? Object.fromEntries(s.repo.changed.map(c => [c.path, false])) : {} })}>
              <Text color={t.dim}>{allOn ? 'Untick all' : 'Tick all'}</Text>
            </Button>
          )}
        </Box>
        {s.repo.changed.length === 0 && <Text color={t.dim}>Nothing uncommitted.</Text>}
        {s.repo.changed.map(c => (
          <Box key={`ch-${c.path}`} columnGap={sp(v, 1)}>
            <Text color={s.staged[c.path] !== false ? t.accent : t.faint}>{s.staged[c.path] !== false ? '▣' : '□'}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Button key={`stage-${c.path}`} plain onPress={() => set($, st => ({ staged: { ...st.staged, [c.path]: st.staged[c.path] === false } }))}>
                <Text color={s.staged[c.path] !== false ? t.text : t.dim} wrap="truncate-end">{c.path}</Text>
              </Button>
            </Box>
            <Text color={kindColor(c.meta)} size="footnote">{c.meta}</Text>
          </Box>
        ))}
      </Box>
      {s.repo.log.length > 0 && (
        <Box flexDirection="column">
          <Box justifyContent="space-between" flexWrap="wrap">
            <Text color={t.text} weight="semibold">Commits</Text>
            <Text color={t.dim} size="footnote">{s.repo.ahead ? `${s.repo.ahead} not pushed · then origin` : 'all pushed'}</Text>
          </Box>
          {s.repo.log.map((c, i) => {
            const own = s.commits.find(x => x.sha === c.sha)
            const unpushed = i < s.repo.ahead
            return (
              <Box key={`lg-${c.sha}`} flexDirection="column">
                <Box columnGap={sp(v, 1)}>
                  <Text color={unpushed ? BUSY : t.accent}>{unpushed ? '◉' : '●'}</Text>
                  <Text color={t.dim} mono>{c.sha}</Text>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text color={t.text} wrap="truncate-end">{c.msg}</Text>
                  </Box>
                  <Text color={t.dim} size="footnote">{c.when}</Text>
                </Box>
                {own && (
                  <Text size="footnote" wrap="truncate-end">
                    <Text color={t.dim}>{'│   '}</Text>
                    <Text color={t.accent}>{own.auto ? 'auto-committed by Cockpit' : 'committed by Cockpit'}</Text>
                    <Text color={t.dim}>{` · ${own.meta}`}</Text>
                  </Text>
                )}
              </Box>
            )
          })}
        </Box>
      )}
      <Box justifyContent="space-between">
        <Button key="git-more" plain onPress={() => set($, st => ({ ui: { ...st.ui, more: !st.ui.more } }))}>
          <Text color={t.dim}>Account, patterns & options</Text>
        </Button>
        <Text color={t.dim}>{s.ui.more ? '⌄' : '›'}</Text>
      </Box>
      {s.ui.more && Options($, v)}
    </Box>
  )
}

// The account box: the accounts found, a token, or a login in the browser
function AccountBox($: $, v: V) {
  const { Box, Button, Input, Text } = v.ui
  const { s, t } = v
  const acct = s.accounts.find(a => a.id === s.accountId)
  // A saved login shows as it is; Modify opens the choices and the ways to add one
  const modify = s.ui.acctOpen || !acct
  const toggle = () => set($, st => ({ ui: { ...st.ui, acctOpen: !st.ui.acctOpen } }))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.divider} paddingX={1}>
      <Box justifyContent="space-between" flexWrap="wrap">
        <Text color={t.text} weight="semibold">Account</Text>
        <Box gap={sp(v, 1)}>
          {modify && <Button key="acct-detect" label="↻ Detect" plain onPress={() => loadAccounts($)} />}
          {acct && <Button key="acct-modify" label={s.ui.acctOpen ? 'Done' : 'Modify'} plain onPress={toggle} />}
        </Box>
      </Box>
      {acct && (
        <Text wrap="truncate-end">
          <Text color={OK}>{'● '}</Text>
          <Text color={t.text}>{acct.label}</Text>
          <Text color={t.dim}>{`  ${acct.name} <${acct.email}>${acct.gh ? ` · gh ${acct.gh}` : ''}`}</Text>
        </Text>
      )}
      {!acct && s.accounts.length === 0 && <Text color={t.dim}>No git identity or gh login found yet.</Text>}
      {modify && s.accounts.length > 0 && <Seg v={v} id="acct" value={s.accountId} items={s.accounts.map(a => [a.id, a.label] as [string, string])} onPick={k => useAccount($, k)} />}
      {modify && acct && (
        <Box gap={sp(v, 1)} flexWrap="wrap">
          <Button key="acct-apply" label="Use for this repo" plain onPress={() => applyAccount($)} />
          <Button key="acct-remove" label="Remove" plain onPress={() => removeAccount($, acct.id)} />
        </Box>
      )}
      {modify && (
        <Box flexDirection="column">
          <Rule v={{ ...v, w: v.w - 4 }} />
          <Text color={t.dim} size="footnote">Add a GitHub login: paste a token, or log in with gh in your browser.</Text>
          <Box columnGap={sp(v, 1)} flexWrap="wrap">
            <Input key="gh-token" label="Token" placeholder="ghp_…" value={s.ui.ghToken} onInput={val => set($, st => ({ ui: { ...st.ui, ghToken: val } }))} onSubmit={val => ghLoginToken($, val)} />
            <Button key="gh-token-go" label="Add token" onPress={() => ghLoginToken($, s.ui.ghToken)} />
            <Button key="gh-web" label="Log in with gh" onPress={() => ghLoginWeb($)} />
          </Box>
        </Box>
      )}
      {s.ui.ghNote !== '' && <Text color={BUSY} wrap="wrap">{s.ui.ghNote}</Text>}
    </Box>
  )
}

// Setup for this repository, once: account, branch pattern, message pattern, commit mode, when
function Setup($: $, v: V) {
  const { Box, Button, Input, Text } = v.ui
  const { s, t } = v
  const g = s.git
  const setGit = (patch: Partial<GitForm>) => setGitPref($, patch)
  const step = s.ui.gitStep
  const go = (n: number) => set($, st => ({ ui: { ...st.ui, gitStep: n } }))
  const titles = ['Account', 'Branch pattern', 'Message pattern', 'Commit mode', 'When']
  const last = g.commitMode === 'manual' ? 3 : 4
  const nav = (
    <Box justifyContent="space-between" flexWrap="wrap">
      {step > 0 ? <Button key="setup-back" label="‹ Back" onPress={() => go(step - 1)} /> : <Text />}
      {step < last ? (
        <Button key="setup-next" label="Next ›" variant="primary" onPress={() => go(step + 1)} />
      ) : (
        <Button key="setup-done" label="Done" variant="primary" onPress={() => Promise.all([setGit({ setupDone: true }), go(0)])} />
      )}
    </Box>
  )
  const sample = { ...g, subject: 'add login page', type: 'feat', ticket: g.ticket || 'API-12' }
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      <Box flexWrap="wrap" columnGap={sp(v, 1)}>
        {titles.slice(0, last + 1).map((name, i) => (
          <Text key={`st-${i}`} color={i === step ? t.accent : i < step ? OK : t.dim} bold={i === step}>{`${i < step ? '✓' : '○'} ${name}`}</Text>
        ))}
      </Box>
      {step === 0 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Text color={t.text} wrap="wrap">Which identity commits in this repository?</Text>
          {AccountBox($, v)}
        </Box>
      )}
      {step === 1 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Text color={t.text} wrap="wrap">How are branches named? Cockpit cuts one off the base branch for each piece of work, kind chosen from the task (feature, fix, docs, …).</Text>
          <Seg v={v} id="bp" value={g.branchPattern} items={BRANCH_PRESETS.map(p => [p.v, p.label] as [string, string])} onPick={k => setGit({ branchPattern: k, branchAuto: true })} />
          <Input key="git-bpat" label="Pattern" value={g.branchPattern} onInput={val => setGit({ branchPattern: val, branchAuto: true })} onSubmit={val => setGit({ branchPattern: val, branchAuto: true })} />
          <Text color={t.dim} size="footnote">{`{kind} {type} {ticket} {slug} {user} · e.g. ${branchName({ ...sample, branchAuto: true }, g.base || 'main')}`}</Text>
          <Box columnGap={sp(v, 2)} flexWrap="wrap">
            <Input key="git-ticket" label="Ticket" placeholder="API-12" value={g.ticket} onInput={val => setGit({ ticket: val })} onSubmit={val => setGit({ ticket: val })} />
            <Input key="git-user" label="User" value={g.user} onInput={val => setGit({ user: val })} onSubmit={val => setGit({ user: val })} />
          </Box>
          <Check v={v} id="opt-branchAuto" on={g.branchAuto} label="Cut a new branch when on the base branch" onPress={() => setGit({ branchAuto: !g.branchAuto })} />
        </Box>
      )}
      {step === 2 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Text color={t.text} wrap="wrap">How are commit messages written? The type comes from the task; the subject from your prompt.</Text>
          <Seg v={v} id="mp" value={g.msgPattern} items={MSG_PRESETS.map(p => [p.v, p.label] as [string, string])} onPick={k => setGit({ msgPattern: k })} />
          <Input key="git-mpat" label="Pattern" value={g.msgPattern} onInput={val => setGit({ msgPattern: val })} onSubmit={val => setGit({ msgPattern: val })} />
          <Text color={t.dim} size="footnote">{`{type} {subject} {Subject} {ticket} {branch} · e.g. ${commitMsg(sample, 'x')}`}</Text>
        </Box>
      )}
      {step === 3 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Text color={t.text} wrap="wrap">What happens to changes Claude makes?</Text>
          {COMMIT_MODES.map(([id, label, desc]) => (
            <Box key={`cm-${id}`} columnGap={sp(v, 1)}>
              <Button key={`mode-${id}`} label={label} variant={g.commitMode === id ? 'primary' : 'secondary'} onPress={() => setGit({ commitMode: id })} />
              <Text color={t.dim} wrap="wrap">{desc}</Text>
            </Box>
          ))}
        </Box>
      )}
      {step === 4 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Text color={t.text} wrap="wrap">{g.commitMode === 'auto' ? 'When does Cockpit commit?' : 'When does Cockpit propose a commit?'}</Text>
          <Seg v={v} id="when" value={g.autoWhen} items={AUTO_WHENS.map(a => [a.v, a.label] as [string, string])} onPick={k => setGit({ autoWhen: k as GitForm['autoWhen'] })} />
          <Box flexWrap="wrap" columnGap={sp(v, 3)}>
            <Check v={v} id="opt-push" on={g.push} label="Push after commit" onPress={() => setGit({ push: !g.push })} />
            <Check v={v} id="opt-pr" on={g.pr} label="Open pull request" onPress={() => setGit({ pr: !g.pr })} />
            <Check v={v} id="opt-preTest" on={g.preTest} label="Only after the Verify experts pass" onPress={() => setGit({ preTest: !g.preTest })} />
          </Box>
        </Box>
      )}
      {nav}
    </Box>
  )
}

// Everything the setup asked, editable later
function Options($: $, v: V) {
  const { Box, Input, Select } = v.ui
  const { s } = v
  const g = s.git
  const setGit = (patch: Partial<GitForm>) => setGitPref($, patch)
  const bases = [...new Set([g.base || s.repo.current, ...s.repo.branches])].filter(Boolean)
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      {AccountBox($, v)}
      <Box columnGap={sp(v, 2)} flexWrap="wrap">
        <Select key="git-mode" label="Mode" value={g.commitMode} options={COMMIT_MODES.map(([id, label]) => ({ value: id, label }))} onSelect={val => setGit({ commitMode: val as GitForm['commitMode'] })} />
        {g.commitMode !== 'manual' && <Select key="git-when" label="When" value={g.autoWhen} options={AUTO_WHENS.map(a => ({ value: a.v, label: a.label }))} onSelect={val => setGit({ autoWhen: val as GitForm['autoWhen'] })} />}
        {bases.length > 0 && <Select key="git-base" label="Base" value={g.base || s.repo.current} options={bases.map(b => ({ value: b }))} onSelect={val => setGit({ base: val })} />}
      </Box>
      <Input key="git-branch" label="Branch (blank: by the pattern)" placeholder={s.repo.current} value={g.branch} onInput={val => setGit({ branch: val })} onSubmit={val => setGit({ branch: val })} />
      <Input key="git-bpat" label="Branch pattern" value={g.branchPattern} onInput={val => setGit({ branchPattern: val, branchAuto: true })} onSubmit={val => setGit({ branchPattern: val, branchAuto: true })} />
      <Input key="git-mpat" label="Message pattern" value={g.msgPattern} onInput={val => setGit({ msgPattern: val })} onSubmit={val => setGit({ msgPattern: val })} />
      <Box columnGap={sp(v, 2)} flexWrap="wrap">
        <Input key="git-ticket" label="Ticket" value={g.ticket} onInput={val => setGit({ ticket: val })} onSubmit={val => setGit({ ticket: val })} />
        <Input key="git-user" label="User" value={g.user} onInput={val => setGit({ user: val })} onSubmit={val => setGit({ user: val })} />
      </Box>
      <Input key="git-body" label="Body" rows={2} value={g.body} onInput={val => setGit({ body: val })} onSubmit={val => setGit({ body: val })} />
      <Box flexWrap="wrap" columnGap={sp(v, 3)}>
        {GIT_OPTS.map(([key, label]) => (
          <Check key={`opt-${key}`} v={v} id={`opt-${key}`} on={!!g[key]} label={label} onPress={() => setGit({ [key]: !g[key] } as Partial<GitForm>)} />
        ))}
      </Box>
    </Box>
  )
}

export type { V }

// A card in the chat, as the design draws tool activity: icon, text, figures on the right
export function Card({ ui, t, w, id, dashed, icon, left, right, onPress }: { ui: UI; t: Theme; w: number; id: string; dashed: boolean; icon: string; left: RenderNode | RenderNode[]; right: string; onPress: () => unknown }) {
  const { Box, Button, Text } = ui
  return (
    <Box borderStyle={dashed ? 'dashed' : 'round'} borderColor={t.lo} paddingX={1} width={w} justifyContent="space-between" columnGap={2}>
      <Box>
        <Text color={t.hi}>{`${icon} `}</Text>
        <Button key={`card-${id}`} plain onPress={onPress}>
          {left}
        </Button>
      </Box>
      <Text color={t.hi}>{right}</Text>
    </Box>
  )
}

// Seats as dots: filled for the winning option, hollow for the rest, faint while voting
export function seatDots(ui: UI, t: Theme, d: Decision) {
  const { Text } = ui
  const top = tally(d).top
  return d.votes.map((v, i) => (
    <Text key={`dot-${d.id}-${i}`} color={v < 0 ? t.faint : v === top ? OK : t.dim}>{v < 0 || v !== top ? '○' : '●'}</Text>
  ))
}
