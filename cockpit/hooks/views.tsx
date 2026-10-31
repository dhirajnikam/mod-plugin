import type { ElementTable, EngineInterface, RenderNode } from 'claude-code'

import type { Account, Agent, Decision, GitForm, Ph, Tab, ThemeId } from '../types'
import {
  applyAccount,
  commit,
  confirmPending,
  createAgent,
  buildMemory,
  discoverAgentTypes,
  loadProject,
  runExpert,
  ghLoginToken,
  ghLoginWeb,
  planCommit,
  pushNow,
  pullNow,
  showCommit,
  skipPending,
  suggestCommit,
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
  rerun,
  compactNow,
  clearNow,
  runMany,
  stopAll,
  clearFinished,
  testAgent,
  TESTERS,
} from './actions'
import {
  AGENT_TYPES,
  stepWords,
  graphRows,
  graphSvg,
  graphText,
  agentIconSvg,
  AUTO_WHENS,
  BRANCH_PRESETS,
  COMMIT_MODES,
  EXPERTS,
  PIPELINES,
  FLOWS,
  progressOf,
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
import type { IconState } from './logic'
import { featureLayers, featureMapSvg, features as featureList, impactOf, isTestFeature, memberOf, memoryKey } from './memory'
import type { FeatureMark } from './memory'
import { pickFlow, setGit as setGitPref } from './actions'
import { THEMES, THEME_IDS, ctxShades } from './theme'
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
    <Box flexWrap="wrap" columnGap={v.desk ? 'sm' : 0} rowGap={v.desk ? 'sm' : 0}>
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
          <Text backgroundColor={s.waiting ? t.busy : s.isWorking ? t.accent : t.text} color={t.bg || 'inverseText'}>{` ${run} `}</Text>
        </Box>
      </Box>
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 2)}>
        <Text color={t.dim} wrap="truncate-start">{v.root.replace(/\\/g, '/').replace(/^.*\/(?=[^/]+\/[^/]+$)/, '…/')}</Text>
        <Text>
          <Text color={t.accent}>{s.repo.isRepo ? `⎇ ${s.repo.current}  ` : ''}</Text>
          <Text color={t.dim}>{s.mode === 'auto' ? 'Auto · judge' : s.mode === 'ask' ? 'Ask · advice' : 'Judges off'}</Text>
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
  const total = tabs.reduce((a, [, l, b]) => a + l.length + (b ? b.length + 2 : 0) + 2, 0) + tabs.length - 1
  const fits = total <= v.w
  const under = tabs.map(([id, label, badge], i) => {
    const n = label.length + (badge ? badge.length + 2 : 0) + 2
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
          const open = () => Promise.all([set($, { tab: id }), id === 'git' ? refreshRepo($) : id === 'agents' ? discoverAgentTypes($) : id === 'files' ? loadProject($) : null])
          return v.desk ? (
            <Button key={`tab-${id}`} label={badge ? `${label} ${badge}` : label} variant={id === s.tab ? 'primary' : 'secondary'} onPress={open} />
          ) : (
            <Button key={`tab-${id}`} plain onPress={open}>
              <Text color={id === s.tab ? t.text : t.dim} bold={id === s.tab} backgroundColor={!fits && id === s.tab ? t.wash || undefined : undefined}>{` ${label}`}</Text>
              {badge ? <Text backgroundColor={t.wash || undefined} color={t.deep}>{` ${badge} `}</Text> : <Text> </Text>}
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

// A change's kind in its status colour: new, deleted, renamed, edited
const kindColor = (t: Theme, meta: string) => (meta === 'new' ? t.ok : meta === 'deleted' ? t.bad : meta.startsWith('renamed') ? t.busy : t.hi)

export function Overview($: $, v: V) {
  const { Box, Button, Text, Svg } = v.ui
  const { s, t, w } = v
  const p = progress(s)
  const cur = s.flows[s.flows.length - 1]
  // The testers' latest cases, and the current flow's last failed tool call
  const vs = verifyState(s.agents)
  const err = s.lastError && cur && s.lastError.at >= cur.startedAt ? s.lastError : undefined
  const changed = s.repo.changed.length
  const needs = s.waiting ? 'Claude is waiting for your answer in the chat.' : s.pending ? `Commit "${s.pending.msg}" → ${s.pending.branch}?` : ''
  const adds = s.repo.changed.reduce((a, c) => a + c.add, 0)
  const dels = s.repo.changed.reduce((a, c) => a + c.del, 0)
  const shades = ctxShades(t)
  const used = s.ctx.used
  const win = s.ctx.window || 200000
  const decs = s.decisions.slice().reverse()
  // The flows before the current one: the current one is the hero above
  const flows = s.flows.slice(0, -1).reverse()
  // Folded sections, kept with the tree's folds: true opens one
  const isOpen = (k: string) => !!s.ui.collapsed[`ov-${k}`]
  const toggle = (k: string) => set($, st => ({ ui: { ...st.ui, collapsed: { ...st.ui.collapsed, [`ov-${k}`]: !st.ui.collapsed[`ov-${k}`] } } }))
  // Every section opens with the same small heading; a fold has an arrow, and one with nothing to hide is a plain
  // heading, as an arrow that changes nothing reads as broken
  const Label = ({ label, n, color }: { label: string; n?: number; color?: string }) => (
    <Text size="footnote" bold>
      <Text color={color ?? t.dim}>{label.toUpperCase()}</Text>
      {n !== undefined && <Text color={t.faint}>{` ${n}`}</Text>}
    </Text>
  )
  const Fold = ({ k, label, n, can = true }: { k: string; label: string; n?: number; can?: boolean }) => !can ? (
    <Label label={label} {...(n !== undefined ? { n } : {})} />
  ) : (
    <Button key={`fold-${k}`} plain onPress={() => toggle(k)}>
      <Text size="footnote" bold>
        <Text color={t.faint}>{isOpen(k) ? '⌄ ' : '› '}</Text>
        <Text color={t.dim}>{label.toUpperCase()}</Text>
        {n !== undefined && <Text color={t.faint}>{` ${n}`}</Text>}
      </Text>
    </Button>
  )
  const ctxCol = s.ctx.pct >= 80 ? t.bad : s.ctx.pct >= 50 ? t.busy : t.dim
  const totals = s.flows.reduce((a, f) => ({ ms: a.ms + ((f.endedAt ?? v.now) - f.startedAt), add: a.add + f.add, del: a.del + f.del, commits: a.commits + (f.commit ? 1 : 0) }), { ms: 0, add: 0, del: 0, commits: 0 })
  return (
    <Box flexDirection="column" gap={v.desk ? 'md' : 1}>
      {needs !== '' && (
        <Box borderStyle="round" borderColor={t.accent} paddingX={1} justifyContent="space-between">
          <Box flexDirection="column">
            <Text color={t.busy} bold>NEEDS YOU</Text>
            <Text color={t.text}>{needs}</Text>
          </Box>
          {s.pending && (
            <Box gap={sp(v, 1)}>
              <Button key="needs-commit" label="Commit" variant="primary" onPress={() => confirmPending($)} />
              <Button key="needs-skip" label="Skip" onPress={() => skipPending($)} />
            </Box>
          )}
        </Box>
      )}
      <Box columnGap={sp(v, 2)} flexWrap="wrap">
        {Svg ? (
          <Svg source={ringSvg(p.pct, '', { accent: t.accent, track: t.track, text: t.text, dim: t.dim })} alt={`${p.pct}% · ${p.stepName}`} width={96} height={96} />
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
          <Text color={s.task ? t.text : t.dim} bold size="heading" wrap="wrap">{s.task || 'No task yet: send a prompt.'}</Text>
          {s.goal && (
            <Box columnGap={sp(v, 1)} alignItems="center">
              <Box flexShrink={1}>
                <Text size="footnote" wrap="wrap">
                  <Text color={t.accent}>{'◎ '}</Text>
                  <Text color={t.dim}>{s.goal.text}</Text>
                  {(cur?.turns ?? 1) > 1 && <Text color={t.faint}>{` · turn ${cur!.turns}`}</Text>}
                </Text>
              </Box>
              <Button key="goal-hide" plain onPress={() => set($, { goal: undefined })}>
                <Text color={t.faint}>×</Text>
              </Button>
            </Box>
          )}
          <Box columnGap={sp(v, 3)} flexWrap="wrap">
            {([['Elapsed', s.isWorking ? fmt(v.now - s.turnStart) : s.lastTurnMs ? fmt(s.lastTurnMs) : '—', s.isWorking ? t.busy : t.text], ['Cost', `$${s.cost.toFixed(2)}`, t.text]] as const).map(([label, val, c]) => (
              <Box key={`st-${label}`} flexDirection="column">
                <Text color={t.faint} size="footnote">{label}</Text>
                <Text color={c} bold>{val}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      <Box flexWrap="wrap" columnGap={sp(v, 1)} alignItems="center">
        {p.steps.map((x, i) => (
          <Text key={`step-${i}-${x.name}`} backgroundColor={x.st === 'active' ? t.wash || undefined : (x.st === 'done' && t.surface) || undefined} color={x.st === 'pending' || x.st === 'skipped' ? t.dim : x.st === 'active' ? t.hi : t.text} bold={x.st === 'active'} strikethrough={x.st === 'skipped'}>
            <Text color={x.st === 'done' ? t.ok : x.st === 'active' ? t.accent : t.faint}>{` ${x.st === 'done' ? '✓' : x.st === 'active' ? '●' : x.st === 'skipped' ? '–' : '○'}`}</Text>
            {` ${x.name} `}
          </Text>
        ))}
        {s.flows.length > 0 && (
          <Button key="flow-pick" plain onPress={() => toggle('flowpick')}>
            <Text color={t.faint} size="footnote">{`${p.flow.label} flow ${isOpen('flowpick') ? '⌄' : '›'}`}</Text>
          </Button>
        )}
      </Box>
      {(vs.cases.length > 0 || vs.running || err) && (
        <Box flexDirection="column">
          <Label label={err || vs.fail ? 'Checks · failing' : 'Checks'} {...(err || vs.fail ? { color: t.bad } : {})} />
          {err && (
            <Text wrap="wrap">
              <Text color={t.bad}>{`✕ ${err.tool} `}</Text>
              <Text color={t.text}>{err.text}</Text>
              <Text color={t.faint}>{` · ${fmt(v.now - err.at)} ago`}</Text>
            </Text>
          )}
          {(vs.cases.length > 0 || vs.running) && (
            <Text wrap="truncate-end">
              <Text color={t.dim}>Tests </Text>
              {vs.pass > 0 && <Text color={t.ok}>{`✓${vs.pass} `}</Text>}
              {vs.fail > 0 && <Text color={t.bad}>{`✗${vs.fail} `}</Text>}
              {vs.running ? <Text color={t.busy}>running</Text> : vs.fail > 0 && <Text color={t.dim}>{`· ${vs.cases.find(c => c.st === 'fail')?.n ?? ''}`}</Text>}
            </Text>
          )}
        </Box>
      )}
      {s.flows.length > 0 && isOpen('flowpick') && (
        <Box flexDirection="column">
          <Seg v={v} id="flow" value={p.flow.name} items={[...(cur?.plan?.length ? [['plan', 'Plan'] as [string, string]] : []), ...(cur?.steps?.length ? [['task', 'Task'] as [string, string]] : []), ...FLOWS.map(f => [f.name, f.label] as [string, string])]} onPick={k => pickFlow($, k)} />
          <Text color={t.faint} size="footnote">{p.flow.name === 'plan' ? "steps from Claude's task list" : p.flow.name === 'task' ? 'steps written for this task' : `steps from the ${p.flow.label} flow${cur?.kind ? ', your pick' : ''}`}</Text>
        </Box>
      )}
      {changed > 0 && (
        <Box flexDirection="column">
          <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Box columnGap={sp(v, 1)}>
              <Label label="Changed files" n={changed} />
              {(adds || dels) > 0 && (
                <Text size="footnote">
                  <Text color={t.ok}>{`+${adds}`}</Text>
                  <Text color={t.bad}>{` −${dels}`}</Text>
                </Text>
              )}
            </Box>
            <Button key="changed-git" plain onPress={() => Promise.all([set($, { tab: 'git' }), refreshRepo($)])}>
              <Text color={t.accent} size="footnote">Open Git ›</Text>
            </Button>
          </Box>
          {s.repo.changed.slice(0, 5).map(c => (
            <Box key={`ovc-${c.path}`} columnGap={sp(v, 1)} alignItems="center">
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-start">
                  <Text color={t.text}>{c.path}</Text>
                  <Text color={kindColor(t, c.meta)} size="footnote">{`  ${c.meta.startsWith('+') ? 'edited' : c.meta.split(' · ')[0]}`}</Text>
                </Text>
              </Box>
              {(c.add || c.del) > 0 && (
                <Text size="footnote">
                  <Text color={t.ok}>{`+${c.add}`}</Text>
                  <Text color={t.bad}>{` −${c.del}`}</Text>
                </Text>
              )}
            </Box>
          ))}
          {changed > 5 && <Text color={t.dim} size="footnote">{`+ ${changed - 5} more in Git`}</Text>}
        </Box>
      )}
      {flows.length > 0 && (
        <Box flexDirection="column">
          <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Fold k="flows" label="Earlier flows" n={flows.length} can={flows.length > 3} />
            <Text size="footnote">
              <Text color={t.faint}>{`total ${fmt(totals.ms)} · `}</Text>
              <Text color={t.ok}>{`+${totals.add}`}</Text>
              <Text color={t.bad}>{` −${totals.del}`}</Text>
              {totals.commits > 0 && <Text color={t.dim}>{` · ${totals.commits} commit${totals.commits === 1 ? '' : 's'}`}</Text>}
            </Text>
          </Box>
          {(isOpen('flows') ? flows : flows.slice(0, 3)).map(f => {
            const open = s.ui.openFlow === f.id
            const live = f.status === 'running'
            const col = live ? t.busy : f.status === 'done' ? t.ok : t.bad
            const took = (f.endedAt ?? v.now) - f.startedAt
            const fp = progressOf(f.task, f.reached, live, f.kind, f.plan, f.steps)
            return (
              <Box key={`fl-${f.id}`} flexDirection="column">
                <Box columnGap={sp(v, 1)} alignItems="center">
                  <Text color={f.status === 'done' ? t.faint : col}>{live ? '●' : f.status === 'done' ? '✓' : '✕'}</Text>
                  <Box flexGrow={1} flexShrink={1}>
                    <Button key={`flb-${f.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openFlow: open ? '' : f.id } }))}>
                      <Text color={live ? t.text : t.text} bold={live} wrap="truncate-end">{f.task}</Text>
                    </Button>
                  </Box>
                  {(f.turns ?? 1) > 1 && <Text color={t.dim} size="footnote">{`×${f.turns}`}</Text>}
                  {(f.add || f.del) > 0 && <Text color={t.faint} size="footnote">{`+${f.add} −${f.del}`}</Text>}
                  {f.commit !== '' && w >= 60 && <Text color={t.accent} size="footnote" mono>{f.commit}</Text>}
                </Box>
                {open && (
                  <Box flexDirection="column" paddingLeft={2}>
                    <Text color={t.dim} size="footnote" wrap="wrap">{`${fmt(took)} · ${fp.pct}% · ${fp.flow.label} flow · ${f.reached.join(' › ')}${f.status === 'aborted' ? ' · stopped' : ''}`}</Text>
                    <Text color={t.dim} size="footnote">{`${(f.turns ?? 1) > 1 ? `${f.turns} turns · ` : ''}${f.ops} file operations · ${f.decisions} decision${f.decisions === 1 ? '' : 's'}${f.commit ? ` · committed ${f.commit}` : ' · not committed'}`}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
          {!isOpen('flows') && flows.length > 3 && <Text color={t.faint} size="footnote">{`+ ${flows.length - 3} earlier`}</Text>}
        </Box>
      )}
      {s.past.length > 0 && (
        <Box flexDirection="column">
          <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Fold k="past" label="Earlier sessions" n={s.past.length} />
          </Box>
          {isOpen('past') && s.past.slice(-8).reverse().map(f => (
            <Box key={`pf-${f.id}`} columnGap={sp(v, 1)}>
              <Text color={f.status === 'done' ? t.ok : t.bad}>{f.status === 'done' ? '✓' : '✕'}</Text>
              <Text color={t.faint} size="footnote" mono>{fmt((f.endedAt ?? f.startedAt) - f.startedAt)}</Text>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={t.dim} wrap="truncate-end">{f.task}</Text>
              </Box>
              {(f.add || f.del) > 0 && <Text color={t.faint} size="footnote">{`+${f.add} −${f.del}`}</Text>}
              {f.commit !== '' && w >= 60 && <Text color={t.accent} size="footnote" mono>{f.commit}</Text>}
            </Box>
          ))}
        </Box>
      )}
      <Box flexDirection="column">
        <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Box columnGap={sp(v, 1)}>
            <Fold k="ctx" label="Context" />
            <Text color={ctxCol} size="footnote" bold>{`${s.ctx.pct}%`}</Text>
          </Box>
          {!s.ui.confirmClear && (
            <Box columnGap={sp(v, 1)}>
              <Button key="ctx-compact" plain onPress={() => compactNow($)}>
                <Text color={t.dim} size="footnote">Compact</Text>
              </Button>
              <Button key="ctx-clear" plain onPress={() => set($, st => ({ ui: { ...st.ui, confirmClear: true } }))}>
                <Text color={t.dim} size="footnote">Clear</Text>
              </Button>
            </Box>
          )}
        </Box>
        <Segs ui={v.ui} w={Math.max(10, w)} track={t.track} parts={s.ctx.segs.map(([, n], i) => [n / win, shades[i] ?? t.faint])} />
        {s.ctx.pct >= 80 && <Text color={t.bad} size="footnote">Auto-compact is about to run.</Text>}
        {isOpen('ctx') && (
          <Box flexWrap="wrap" columnGap={sp(v, 3)}>
            <Text color={t.dim}>{`${kTok(used)} of ${kTok(win)}`}</Text>
            {s.ctx.segs.map(([name, n], i) => (
              <Text key={`lg-${name}`}>
                <Text color={shades[i] ?? t.faint}>■ </Text>
                <Text color={t.dim}>{`${name} `}</Text>
                <Text color={t.text}>{kTok(n)}</Text>
              </Text>
            ))}
          </Box>
        )}
        {s.ui.confirmClear && (
          <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Text color={t.busy} size="footnote" wrap="wrap">Clear the conversation? Claude starts afresh; the transcript stays in your history.</Text>
            <Box columnGap={sp(v, 1)}>
              <Button key="ctx-clear-yes" label="Clear now" plain onPress={() => clearNow($)} />
              <Button key="ctx-clear-no" label="Cancel" plain onPress={() => set($, st => ({ ui: { ...st.ui, confirmClear: false } }))} />
            </Box>
          </Box>
        )}
      </Box>
      <Box flexDirection="column">
        <Box justifyContent="space-between" flexWrap="wrap">
          <Fold k="dec" label="Decisions" {...(decs.length ? { n: decs.length } : {})} />
          {!isOpen('dec') && <Text color={t.faint} size="footnote">{s.mode === 'auto' ? 'Judges decide' : s.mode === 'ask' ? 'Judges advise' : 'Judges off'}</Text>}
        </Box>
        {isOpen('dec') && <Seg v={v} id="mode" value={s.mode} items={[['auto', 'Auto · judge'], ['ask', 'Ask me'], ['off', 'Off']]} onPick={k => set($, { mode: k })} />}
        {isOpen('dec') && <Text color={t.dim} size="footnote" wrap="wrap">{s.mode === 'off' ? 'Judges off: every question and next step is yours, with no advice.' : `${s.mode === 'auto' ? 'The judges answer questions and next steps; anything hard to undo, a split, or a fourth in a row comes to you with their advice.' : 'Every question and next step is yours; the judges say what they recommend.'} Complexity 0–3 → 3 judges · 4–6 → 6 · 7–10 → 9 · two thirds to pass.`}</Text>}
        {(isOpen('dec') ? decs : decs.slice(0, 3)).map(d => {
          const tl = tally(d)
          const open = s.ui.openDec === d.id
          return (
            <Box key={`dec-${d.id}`} flexDirection="column">
              <Box justifyContent="space-between" columnGap={sp(v, 2)} alignItems="center">
                <Box flexGrow={1} flexShrink={1}>
                  <Button key={`decb-${d.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, openDec: open ? '' : d.id } }))}>
                    <Text color={t.text} wrap="truncate-end">{d.q}</Text>
                  </Button>
                </Box>
                <Text color={d.status === 'decided' ? t.ok : d.status === 'split' ? t.busy : d.status === 'you' ? t.dim : d.status === 'advised' ? t.accent : t.deep} size="footnote">{d.result || (d.status === 'you' ? 'yours' : d.status === 'scoring' ? 'scoring…' : `voting ${tl.revealed}/${tl.n}`)}</Text>
              </Box>
              {open && d.advice && <Text color={t.dim} size="footnote" wrap="wrap">{d.advice}</Text>}
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
                        <Text key={`seat-${d.id}-${i}`} color={vote < 0 ? t.faint : vote === tl.top ? t.ok : t.bad}>
                          {vote === -2 ? '–' : vote < 0 ? '◌' : vote === tl.top ? '✓' : '×'}
                        </Text>
                      ))}
                      <Text color={t.dim}>{` ${tl.yes} for · ${tl.revealed - tl.yes} against · needs ${thrOf(tl.n)}`}</Text>
                    </Box>
                  )}
                  <Text color={t.dim}>{d.opts.map((o, i) => `${i + 1}. ${o} (${tl.counts[i] ?? 0})`).join('   ')}</Text>
                </Box>
              )}
            </Box>
          )
        })}
        {!isOpen('dec') && decs.length > 3 && <Text color={t.faint} size="footnote">{`+ ${decs.length - 3} earlier`}</Text>}
      </Box>
    </Box>
  )
}

// A section's heading, as every tab draws it: small capitals, a dim count, a colour of its own when it warns
function Head({ v, label, n, color, note }: { v: V; label: string; n?: number; color?: string; note?: string }) {
  const { Text } = v.ui
  return (
    <Text size="footnote" bold wrap="truncate-end">
      <Text color={color ?? v.t.dim}>{label.toUpperCase()}</Text>
      {n !== undefined && <Text color={v.t.faint}>{` ${n}`}</Text>}
      {note !== undefined && <Text color={v.t.faint}>{`  ${note}`}</Text>}
    </Text>
  )
}

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
        <Box flexDirection="column">
          {featureLayers(shown).map((layer, i) => (
            <Box key={`ml-${i}`} flexDirection="column">
              {layer.map(n => {
                const f = shown.find(x => x.name === n)!
                const m = marks[n]
                const uses = f.uses.filter(u => shown.some(x => x.name === u))
                return (
                  <Text key={`mn-${n}`} wrap="truncate-end">
                    <Text color={t.faint}>{'  '.repeat(i)}</Text>
                    <Text color={m === 'now' ? t.busy : m === 'touched' ? t.accent : m === 'reached' ? t.busy : t.faint}>{m === 'now' ? '■ ' : m === 'touched' ? '◆ ' : m === 'reached' ? '◇ ' : '· '}</Text>
                    <Text color={m ? t.text : t.dim} bold={m === 'now'}>{n}</Text>
                    {uses.length > 0 && <Text color={t.faint}>{` → ${uses.join(', ')}`}</Text>}
                  </Text>
                )
              })}
            </Box>
          ))}
        </Box>
      ))}
      {open && (tests.length > 0 || fs.length > shown.length + tests.length) && (
        <Text color={t.faint} size="footnote" wrap="wrap">
          {[tests.length ? `${tests.length} test feature${tests.length === 1 ? '' : 's'} not drawn` : '', fs.length > shown.length + tests.length ? `${fs.length - shown.length - tests.length} smaller left out` : ''].filter(Boolean).join(' · ')}
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
        <Button key="mem-rebuild" plain onPress={() => buildMemory($, true)}>
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
  return (
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
      {rows_.length === 0 && <Text color={t.dim} wrap="wrap">No files found here yet: send a prompt, and what Claude reads, writes and runs shows here as it happens.</Text>}
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
      {feed.length > 0 && (
        <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Head v={v} label="Feed" {...(filter ? { note: filter } : {})} />
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
              <Text color={o.add || o.del ? (o.add >= o.del ? t.ok : t.bad) : t.dim} size="footnote">{o.add || o.del ? `+${o.add} −${o.del}` : o.meta}</Text>
              <Text color={t.dim} size="footnote">{ago(o.at)}</Text>
            </Box>
            {open && o.lines.length > 0 && <Box flexDirection="column" paddingLeft={2}>{diffLines(o.id, o.lines)}</Box>}
          </Box>
        )
      })}
    </Box>
  )
}

// Agents: the pipelines and + New agent in one row; a running pipeline as a strip of icons; the team as one row per
// agent (icon, name, one line of what it is doing, ▶ or ■); and the runs, only once there are any
export function Agents($: $, v: V) {
  const { Box, Button, Input, Select, Svg, Text } = v.ui
  const { s, t } = v
  const types = s.agentTypes.length ? s.agentTypes : AGENT_TYPES
  // An agent's last run, since you last cleared the list (a cleared one, or an earlier session's from before, is not shown)
  const shown = (a: Agent) => !s.cleared.includes(a.id) && (a.status === 'running' || (a.endedAt ?? a.startedAt) > s.clearedAt)
  const latestOf = (type: string) => [...s.pastAgents, ...s.agents].filter(a => a.type === type && shown(a)).pop()
  const pipe = s.pipeline
  const running = s.agents.filter(a => a.status === 'running').length
  const finished = s.agents.filter(a => a.status === 'done').length
  const team = [...EXPERTS.map(x => ({ type: x.type, name: x.name, what: x.what })), ...s.custom]
  const stateOf = (a?: Agent): IconState => (!a ? 'idle' : a.status === 'running' ? 'running' : a.status === 'failed' || a.cases.some(c => c.st === 'fail') ? 'failed' : a.status === 'stopped' ? 'stopped' : 'done')
  const colorOf = (st: IconState) => (st === 'running' ? t.busy : st === 'done' ? t.ok : st === 'failed' ? t.bad : st === 'idle' ? t.accent : t.dim)
  const spin = ['◐', '◓', '◑', '◒'][Math.floor(v.now / 200) % 4] ?? '◐'
  // The icon: SVG where the surface draws it (animated while running), else a glyph that turns while running
  const icon = (type: string, st: IconState, size: number) =>
    Svg ? (
      <Svg source={agentIconSvg(type, st)} alt={`${expertName(type)}: ${st}`} width={size} height={size} />
    ) : (
      <Text color={colorOf(st)} bold>{st === 'running' ? spin : expertGlyph(type)}</Text>
    )
  const word = (a: Agent) => ({ running: 'Running', done: 'Done', stopped: 'Stopped', failed: 'Failed' })[a.status]
  const took = (a: Agent) => fmt((a.endedAt ?? v.now) - a.startedAt)
  const reportOf = (a?: Agent) => a?.report.split('\n').find(l => l.startsWith('REPORT:'))?.slice(7).trim() ?? ''
  // The two testers on a run: the positive (Prover) and the negative (Breaker), each its latest
  const testsOf = (id: string) => {
    const mine = [...s.pastAgents, ...s.agents].filter(x => x.for === id && shown(x))
    return { pos: mine.filter(x => x.type === TESTERS[0]).pop(), neg: mine.filter(x => x.type === TESTERS[1]).pop() }
  }
  const verdict = (x: Agent | undefined, label: string, sign: string, waiting: boolean) => {
    if (!x) return waiting ? { t: `${sign} ${label} waiting`, c: t.faint } : undefined
    if (x.status === 'running') return { t: `${spin} ${label} testing`, c: t.busy }
    const fail = x.cases.filter(c => c.st === 'fail').length
    if (x.status !== 'done') return { t: `${sign} ${label} ${word(x).toLowerCase()}`, c: t.bad }
    return { t: x.cases.length ? `${sign} ${label} ${x.cases.length - fail}/${x.cases.length}` : `${sign} ${label} done`, c: fail ? t.bad : t.ok }
  }
  const testLine = (id: string, key: string) => {
    const { pos, neg } = testsOf(id)
    if (!pos && !neg) return null
    const parts = [verdict(pos, 'positive', '+', false), verdict(neg, 'negative', '−', !!pos)].filter(p => p !== undefined)
    return (
      <Text key={key} size="footnote" wrap="truncate-end">
        {parts.map((p, i) => (
          <Text key={`${key}-${i}`} color={p.c}>{`${i ? '   ' : ''}${p.t}`}</Text>
        ))}
      </Text>
    )
  }
  // Run again with your instructions: a team agent with them as its task, or a run with them added to its brief
  const instructions = (target: string, hint: string) => (
    <Box key={`rr-${target}`} flexDirection="column" paddingLeft={4}>
      <Input
        key="rerun-input"
        label="Instructions"
        placeholder={hint}
        value={s.ui.rerunText}
        onInput={val => set($, st => ({ ui: { ...st.ui, rerunText: val } }))}
        onSubmit={val => rerun($, target, val)}
      />
      <Box columnGap={sp(v, 1)}>
        {pill('rerun-go', '▶ Run with these', true, () => rerun($, target, s.ui.rerunText))}
        {pill('rerun-cancel', 'Cancel', false, () => set($, st => ({ ui: { ...st.ui, rerunFor: '', rerunText: '' } })))}
      </Box>
    </Box>
  )
  // A button: the surface's own on desktop; on the terminal a filled chip, as the tabs are, in place of [ brackets ]
  const pill = (key: string, label: string, on: boolean, onPress: () => unknown) =>
    v.desk ? (
      <Button key={key} label={label} variant={on ? 'primary' : 'secondary'} onPress={onPress} />
    ) : (
      <Button key={key} label={label} plain onPress={onPress}>
        <Text backgroundColor={on ? t.accent : t.track} color={on ? t.bg || 'inverseText' : t.text} bold={on}>{` ${label} `}</Text>
      </Button>
    )
  // One run: its icon, name (a press opens its cases, report, steps and transcript), what it is doing or was asked,
  // its state, tool calls and time, and stop or restart and ✎
  const runRow = (a: Agent) => {
              const open = s.ui.openAgent === a.id
              const st = stateOf(a)
              const live = st === 'running'
              const failing = a.cases.filter(c => c.st === 'fail')
              return (
                <Box key={`ag-${a.id}`} flexDirection="column">
                  <Box alignItems="center" columnGap={sp(v, 1)}>
                    <Box flexShrink={0}>{icon(a.type, st, 28)}</Box>
                    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                      <Button key={`agb-${a.id}`} plain onPress={() => set($, x => ({ ui: { ...x.ui, openAgent: open ? '' : a.id } }))}>
                        <Text color={t.text} bold wrap="truncate-end">{`${a.name} ${open ? '⌄' : '›'}`}</Text>
                      </Button>
                      <Text color={live ? t.busy : t.dim} size="footnote" wrap="truncate-end">
                        {a.for ? `testing the ${s.agents.find(x => x.id === a.for)?.name ?? 'agent'}'s work${live ? ` · ${stepWords(a.log[a.log.length - 1]?.t)}` : ''}` : live ? stepWords(a.log[a.log.length - 1]?.t) : a.task}
                      </Text>
                      {testLine(a.id, `rl-${a.id}`)}
                    </Box>
                    <Text size="footnote" wrap="truncate-end">
                      {!live && <Text color={colorOf(st)}>{`${word(a)} · `}</Text>}
                      <Text color={live ? t.busy : t.dim}>{`${a.tools} tool call${a.tools === 1 ? '' : 's'} · ${took(a)}`}</Text>
                    </Text>
                    {a.status === 'done' && !TESTERS.includes(a.type) && !testsOf(a.id).pos && <Button key={`test-${a.id}`} label="± Test" plain onPress={() => testAgent($, a.id, false)} />}
                    {live ? (
                      <Button key={`stop-${a.id}`} plain onPress={() => stopAgent($, a.id)}>
                        <Text color={t.bad}>■</Text>
                      </Button>
                    ) : (
                      <Button key={`restart-${a.id}`} plain onPress={() => rerun($, a.id, '')}>
                        <Text color={t.dim}>↻</Text>
                      </Button>
                    )}
                    <Button key={`redo-${a.id}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, rerunFor: st.ui.rerunFor === a.id ? '' : a.id, rerunText: '' } }))}>
                      <Text color={t.faint}>✎</Text>
                    </Button>
                  </Box>
                  {s.ui.rerunFor === a.id && instructions(a.id, `Run the ${a.name.toLowerCase()} again, and…`)}
                  {(open ? a.cases : failing).map((c, i) => (
                    <Text key={`case-${a.id}-${i}`} size="footnote" wrap="truncate-end">
                      <Text color={c.st === 'fail' ? t.bad : c.st === 'fixed' ? t.busy : t.ok}>{`   ${c.st === 'fail' ? '✗' : c.st === 'fixed' ? '↻' : '✓'} `}</Text>
                      <Text color={t.text}>{c.n}</Text>
                      {c.err && <Text color={t.dim}>{` · ${c.err}`}</Text>}
                    </Text>
                  ))}
                  {open && (
                    <Box flexDirection="column" paddingLeft={2}>
                      <Text color={t.faint} size="footnote">{a.type}</Text>
                      {a.report !== '' && <Text color={t.dim} size="footnote" wrap="wrap">{a.report}</Text>}
                      {a.log.slice(-8).map((l, i) => (
                        <Text key={`log-${a.id}-${i}`} size="footnote" wrap="truncate-end">
                          <Text color={t.faint}>{`${fmt(l.at - a.startedAt)}  `}</Text>
                          <Text color={t.text}>{l.t}</Text>
                        </Text>
                      ))}
                      <Button key={`view-${a.id}`} label="Open transcript" plain onPress={() => $.ui.view({ agentId: a.id })} />
                    </Box>
                  )}
                </Box>
              )
  }
  const live_ = s.agents.filter(a => a.status === 'running' && a.id !== pipe?.agentId).slice().reverse()
  const done_ = s.agents.filter(a => a.status !== 'running').slice().reverse()
  const allDone = !!s.ui.collapsed['ag-finished']
  const section = (label: string, extra = '') => (
    <Text size="footnote">
      <Text color={t.dim} bold>{label.toUpperCase()}</Text>
      {extra !== '' && <Text color={t.faint}>{`  ${extra}`}</Text>}
    </Text>
  )
  return (
    <Box flexDirection="column" gap={sp(v, 2)}>
      <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)} rowGap={v.desk ? 'sm' : 0}>
        <Box flexWrap="wrap" columnGap={sp(v, 1)}>
          {PIPELINES.map(p => pill(`pipe-${p.name}`, `▶ ${p.label}`, false, () => startPipeline($, p.name)))}
        </Box>
        {pill('spawn-toggle', s.ui.spawnOpen ? '✕ Close' : '+ New agent', false, () => set($, st => ({ ui: { ...st.ui, spawnOpen: !st.ui.spawnOpen } })))}
      </Box>
      {pipe && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.accent} paddingX={1}>
          <Box justifyContent="space-between" alignItems="center" columnGap={sp(v, 1)}>
            <Text wrap="truncate-end">
              <Text color={t.busy} bold>{`${PIPELINES.find(p => p.name === pipe.name)?.label ?? pipe.name} pipeline`}</Text>
              <Text color={t.dim}>{` · ${fmt(v.now - pipe.at)}`}</Text>
            </Text>
            {pipe.agentId !== '' && (
              <Button key="pipe-stop" plain onPress={() => stopAgent($, pipe.agentId)}>
                <Text color={t.bad} size="footnote">■ Stop</Text>
              </Button>
            )}
          </Box>
          <Box alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
            {pipe.steps.map((st, i) => {
              const at: IconState = i < pipe.index ? 'done' : i === pipe.index ? 'running' : 'pending'
              return (
                <Box key={`ps-${i}`} alignItems="center" columnGap={sp(v, 1)}>
                  {i > 0 && <Text color={i <= pipe.index ? t.ok : t.faint}>›</Text>}
                  {icon(st, at, 24)}
                  <Text color={at === 'pending' ? t.dim : colorOf(at)} bold={at === 'running'} size="footnote">{expertName(st)}</Text>
                  {at === 'done' && (() => {
                    const ran = s.agents.filter(x => x.type === st && x.startedAt >= pipe.at).pop()
                    const fail = ran?.cases.filter(c => c.st === 'fail').length ?? 0
                    return ran?.cases.length ? <Text color={fail ? t.bad : t.ok} size="footnote">{`${fail ? '✗' : '✓'}${ran.cases.length - fail}/${ran.cases.length}`}</Text> : null
                  })()}
                </Box>
              )
            })}
          </Box>
          {pipe.reports.length > 0 && (
            <Text size="footnote" wrap="truncate-end">
              <Text color={t.accent}>{'↳ '}</Text>
              <Text color={t.dim}>{pipe.reports[pipe.reports.length - 1]?.split('\n').find(l => l.startsWith('HANDOFF:'))?.slice(8).trim() || 'report handed on'}</Text>
            </Text>
          )}
        </Box>
      )}
      {s.ui.spawnOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
          <Input
            key="describe"
            label="Describe the agent"
            placeholder="Checks every API change for breaking changes and missing docs"
            value={s.ui.describe}
            onInput={val => set($, st => ({ ui: { ...st.ui, describe: val } }))}
            onSubmit={val => val.trim() && createAgent($, val.trim())}
          />
          <Box columnGap={sp(v, 2)} flexWrap="wrap" alignItems="center">
            <Button key="describe-go" label={s.creating ? 'Making the agent…' : 'Create agent'} variant="primary" onPress={() => (s.ui.describe.trim() && !s.creating ? createAgent($, s.ui.describe.trim()) : undefined)} />
            <Text color={t.dim} size="footnote" wrap="wrap">{s.creating ? `${spin} writing its definition` : 'Joins the team, kept for later sessions'}</Text>
          </Box>
          <Rule v={{ ...v, w: v.w - 4 }} />
          <Text color={t.dim} size="footnote">Or run a task now with any agent type</Text>
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
            <Input key="spawn-type-custom" label="or any type" placeholder="my-plugin:reviewer" value={types.includes(s.ui.spawnType) ? '' : s.ui.spawnType} onInput={val => set($, st => ({ ui: { ...st.ui, spawnType: val.trim() || (types[0] ?? 'general-purpose') } }))} onSubmit={val => set($, st => ({ ui: { ...st.ui, spawnType: val.trim() || (types[0] ?? 'general-purpose') } }))} />
            <Button key="spawn-go" label="Start" onPress={() => (s.ui.spawnTask.trim() ? spawnAgent($, s.ui.spawnTask.trim(), s.ui.spawnType) : undefined)} />
          </Box>
        </Box>
      )}
      {Object.values(s.ui.selected).some(Boolean) && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.accent} paddingX={1}>
          <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Text color={t.text} bold>{`${Object.values(s.ui.selected).filter(Boolean).length} selected · run them at once`}</Text>
            <Box columnGap={sp(v, 1)}>
              {pill('run-selected', '▶ Run selected', true, () => runMany($, Object.keys(s.ui.selected).filter(k => s.ui.selected[k]), s.ui.runTask.trim()))}
              {pill('pick-none', 'Clear', false, () => set($, st => ({ ui: { ...st.ui, selected: {} } })))}
            </Box>
          </Box>
          <Input
            key="run-task"
            label="Task for them"
            placeholder={s.task ? `the current task: ${s.task.slice(0, 60)}` : 'what they should work on'}
            value={s.ui.runTask}
            onInput={val => set($, st => ({ ui: { ...st.ui, runTask: val } }))}
            onSubmit={val => runMany($, Object.keys(s.ui.selected).filter(k => s.ui.selected[k]), val.trim())}
          />
        </Box>
      )}
      {live_.length > 0 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
            {section('Running', String(live_.length))}
            <Button key="stop-all" plain onPress={() => stopAll($)}>
              <Text color={t.dim} size="footnote">■ Stop all</Text>
            </Button>
          </Box>
          {live_.map(runRow)}
        </Box>
      )}
      <Box flexDirection="column" gap={sp(v, 1)}>
        {section('Team', `${team.length} agents`)}
        {team.map(x => {
          const a = latestOf(x.type)
          const st = stateOf(a)
          const live = st === 'running'
          const fails = a?.cases.filter(c => c.st === 'fail').length ?? 0
          const sub = reportOf(a) || x.what
          const copies = s.agents.filter(r => r.type === x.type && r.status === 'running')
          const right = !a || live ? '' : a.cases.length ? `${a.cases.length - fails}/${a.cases.length} passed` : a.status === 'done' ? `✓ ${took(a)}` : word(a).toLowerCase()
          const ticked = !!s.ui.selected[x.type]
          const rowEl = (
            <Box key={`ex-${x.type}`} alignItems="center" columnGap={sp(v, 1)}>
              <Box flexShrink={0}>{icon(x.type, st, 28)}</Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text color={t.text} bold wrap="truncate-end">{x.name}</Text>
                <Text color={t.dim} size="footnote" wrap="truncate-end">{sub}</Text>
                {a && !live && testLine(a.id, `tl-${x.type}`)}
              </Box>
              {right !== '' && <Text color={colorOf(st)} size="footnote">{right}</Text>}
              {live && <Text color={t.faint} size="footnote">{`running${copies.length > 1 ? ` ×${copies.length}` : ''} ↑`}</Text>}
              <Button key={`run-${x.type}`} plain onPress={() => runExpert($, x.type)}>
                <Text color={live ? t.faint : t.dim}>▶</Text>
              </Button>
              <Button key={`edit-${x.type}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, rerunFor: st.ui.rerunFor === `type:${x.type}` ? '' : `type:${x.type}`, rerunText: '' } }))}>
                <Text color={t.faint}>✎</Text>
              </Button>
              <Button key={`pick-${x.type}`} plain onPress={() => set($, st => ({ ui: { ...st.ui, selected: { ...st.ui.selected, [x.type]: !st.ui.selected[x.type] } } }))}>
                <Text color={ticked ? t.accent : t.faint}>{ticked ? '▣' : '□'}</Text>
              </Button>
            </Box>
          )
          return s.ui.rerunFor === `type:${x.type}` ? (
            <Box key={`exw-${x.type}`} flexDirection="column">
              {rowEl}
              {instructions(`type:${x.type}`, `Run the ${x.name.toLowerCase()} on…`)}
            </Box>
          ) : (
            rowEl
          )
        })}
      </Box>
      {done_.length > 0 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Button key="fold-finished" plain onPress={() => set($, st => ({ ui: { ...st.ui, collapsed: { ...st.ui.collapsed, 'ag-finished': !allDone } } }))}>
              <Text size="footnote" bold>
                <Text color={t.faint}>{allDone || done_.length <= 3 ? '⌄ ' : '› '}</Text>
                <Text color={t.dim}>FINISHED</Text>
                <Text color={t.faint}>{` ${done_.length}`}</Text>
              </Text>
            </Button>
            <Button key="clear-finished" plain onPress={() => clearFinished($)}>
              <Text color={t.dim} size="footnote">Clear</Text>
            </Button>
          </Box>
          {(allDone ? done_ : done_.slice(0, 3)).map(runRow)}
          {!allDone && done_.length > 3 && <Text color={t.faint} size="footnote">{`+ ${done_.length - 3} earlier`}</Text>}
        </Box>
      )}
      <Box flexDirection="column">
        <Button key="fold-settings" plain onPress={() => set($, st => ({ ui: { ...st.ui, collapsed: { ...st.ui.collapsed, 'ag-settings': !st.ui.collapsed['ag-settings'] } } }))}>
          <Text size="footnote" bold>
            <Text color={t.faint}>{s.ui.collapsed['ag-settings'] ? '⌄ ' : '› '}</Text>
            <Text color={t.dim}>SETTINGS</Text>
            <Text color={t.faint} bold={false}>{`  both testers ${s.testAgents ? 'on' : 'off'} · verify each turn ${s.autoVerify ? 'on' : 'off'}`}</Text>
          </Text>
        </Button>
        {s.ui.collapsed['ag-settings'] && <Check v={v} id="testagents" on={s.testAgents} label="Test each agent's work: a positive and a negative tester" onPress={() => set($, st => ({ testAgents: !st.testAgents }))} />}
        {s.ui.collapsed['ag-settings'] && <Check v={v} id="autoverify" on={s.autoVerify} label="Verify after each turn that changes files" onPress={() => set($, st => ({ autoVerify: !st.autoVerify }))} />}
      </Box>
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
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
        <Text>
          <Text color={t.accent} bold>{`⎇ ${s.repo.current || '(no branch)'}`}</Text>
          {s.repo.ahead > 0 && <Text color={t.busy}>{`  ↑${s.repo.ahead} to push`}</Text>}
          {s.repo.behind > 0 && <Text color={t.hi}>{`  ↓${s.repo.behind} to pull`}</Text>}
          {s.repo.changed.length > 0 && <Text color={t.dim}>{`  ·  ${s.repo.changed.length} changed`}</Text>}
        </Text>
        <Box gap={sp(v, 1)} flexWrap="wrap">
          {s.repo.behind > 0 && <Button key="git-pull" label="↓ Pull" plain onPress={() => pullNow($)} />}
          {s.repo.ahead > 0 && <Button key="git-push" label="↑ Push" plain onPress={() => pushNow($)} />}
          <Button key="git-refresh" label="↻" plain onPress={() => refreshRepo($)} />
          <Button key="git-setup" label="⚙" plain onPress={() => Promise.all([setGit({ setupDone: false }), set($, st => ({ ui: { ...st.ui, gitStep: 0 } }))])} />
        </Box>
      </Box>
      <Text color={t.dim} size="footnote" wrap="truncate-end">{`${acct ? `${acct.label} <${acct.email}>` : 'no account'}  ·  ${mode}${when}`}</Text>
      {s.pending && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.busy} paddingX={1}>
          <Text color={t.busy} bold>Commit this?</Text>
          <Text color={t.hi} mono wrap="truncate-end">{s.pending.msg}</Text>
          <Text color={t.dim} size="footnote">{`→ ${s.pending.branch} · ${s.pending.files.length} files`}</Text>
          <Box gap={sp(v, 1)}>
            <Button key="pend-commit" label="Commit" variant="primary" onPress={() => confirmPending($)} />
            <Button key="pend-skip" label="Skip" onPress={() => skipPending($)} />
          </Box>
        </Box>
      )}
      {s.repo.changed.length === 0 && (
        <Text>
          <Text color={t.ok}>{'✓ '}</Text>
          <Text color={t.text}>Working tree clean</Text>
          <Text color={t.dim}>{s.repo.ahead ? `  ·  ${s.repo.ahead} to push` : s.repo.unpushed.length || s.repo.log.length ? '  ·  nothing to commit or push' : '  ·  nothing to commit'}</Text>
        </Text>
      )}
      {s.repo.changed.length > 0 && (
      <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
        <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Text color={t.text} weight="semibold">Next commit</Text>
          <Text>
            <Text color={t.deep} backgroundColor={t.wash || undefined} bold>{` ${plan.type} `}</Text>
            <Text color={t.dim} size="footnote">{g.commitMode === 'manual' ? '  your pick' : s.suggest?.busy ? '  writing from the diff…' : '  from the changes'}</Text>
          </Text>
        </Box>
        {g.commitMode === 'manual' && <Seg v={v} id="ctype" value={g.type} items={TYPES.map(x => [x, x] as [string, string])} onPick={k => setGit({ type: k })} />}
        <Text color={plan.msg ? t.hi : t.dim} mono wrap="truncate-end">{plan.msg || 'Send a prompt, or change a file'}</Text>
        <Text size="footnote" wrap="truncate-end">
          <Text color={newBranch ? t.ok : t.dim}>{newBranch ? `⎇ new ${plan.branch}` : `⎇ ${plan.branch}`}</Text>
          <Text color={t.dim}>{`  ·  ${staged} of ${s.repo.changed.length} files${g.push ? '  ·  push' : ''}${g.pr ? `  ·  ${g.draft ? 'draft PR' : 'PR'} → ${g.base}` : ''}`}</Text>
        </Text>
        <Box justifyContent="flex-end">
          {staged > 0 ? <Button key="git-commit" label={g.push ? 'Commit & push' : 'Commit'} variant="primary" onPress={() => commit($, false)} /> : <Text color={t.dim} size="footnote">Tick a file to commit it</Text>}
        </Box>
      </Box>
      )}
      {s.repo.changed.length > 0 && (
      <Box flexDirection="column">
        <Box justifyContent="space-between" flexWrap="wrap">
          <Text color={t.text} weight="semibold">{`Changes${s.repo.changed.length ? ` (${s.repo.changed.length})` : ''}`}</Text>
          {s.repo.changed.length > 1 && (
            <Button key="stage-all" plain onPress={() => set($, { staged: allOn ? Object.fromEntries(s.repo.changed.map(c => [c.path, false])) : {} }).then(() => suggestCommit($))}>
              <Text color={t.dim}>{allOn ? 'Untick all' : 'Tick all'}</Text>
            </Button>
          )}
        </Box>
        {s.repo.changed.map(c => (
          <Box key={`ch-${c.path}`} columnGap={sp(v, 1)}>
            <Text color={s.staged[c.path] !== false ? t.accent : t.faint}>{s.staged[c.path] !== false ? '▣' : '□'}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Button key={`stage-${c.path}`} plain onPress={() => set($, st => ({ staged: { ...st.staged, [c.path]: st.staged[c.path] === false } })).then(() => suggestCommit($))}>
                <Text color={s.staged[c.path] !== false ? t.text : t.dim} wrap="truncate-end">{c.path}</Text>
              </Button>
            </Box>
            <Text color={kindColor(t, c.meta)} size="footnote">{c.meta}</Text>
          </Box>
        ))}
      </Box>
      )}
      {s.repo.log.length > 0 && History($, v)}
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

// History: every branch, remote and tag as a graph, newest first. Each commit is a dot on its lane, lines carry the
// lanes down, a merge opens a lane and a branch joins one; refs ride on the commit as chips (HEAD's branch filled,
// local branches tinted, remotes and tags plain), unpushed commits are hollow, and a press opens the commit
function History($: $, v: V) {
  const { Box, Button, Svg, Text } = v.ui
  const { s, t } = v
  const log = s.repo.log
  const rows = graphRows(log)
  const width = Math.min(8, Math.max(1, ...rows.map(r => r.width)))
  const wide = v.w >= 60
  const pushed = s.repo.unpushed.length ? `${s.repo.unpushed.length} not pushed` : s.repo.ahead ? `${s.repo.ahead} not pushed` : 'all pushed'
  const chip = (ref: string, key: string) => {
    const head = ref.startsWith('HEAD')
    const name = ref.replace(/^HEAD -> /, '').replace(/^tag: /, '')
    const kind = head ? 'head' : ref.startsWith('tag: ') ? 'tag' : s.repo.branches.includes(name) ? 'branch' : 'remote'
    const [fg, bg, mark] =
      kind === 'head' ? [t.bg || 'inverseText', t.accent, '⎇ '] : kind === 'branch' ? [t.hi, t.wash || undefined, '⎇ '] : kind === 'tag' ? [t.ok, t.surface || undefined, '⌑ '] : [t.dim, t.surface || undefined, '☁ ']
    return (
      <Text key={key} color={fg} backgroundColor={bg} bold={kind === 'head'}>{` ${mark}${name} `}</Text>
    )
  }
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
        <Text color={t.text} weight="semibold">History</Text>
        <Text color={t.dim} size="footnote">{`${log.length} commits · ${s.repo.branches.length} branches · ${pushed}`}</Text>
      </Box>
      {log.map((c, i) => {
        const r = rows[i]
        if (!r) return null
        const isHead = c.refs.some(x => x.startsWith('HEAD'))
        const unpushed = s.repo.unpushed.includes(c.sha)
        const node = isHead ? 'head' : unpushed ? 'unpushed' : c.parents.length > 1 ? 'merge' : 'plain'
        const own = s.commits.find(x => x.sha === c.sha)
        const open = s.ui.openCommit === c.sha
        const lane = (
          <Box flexShrink={0}>
            {Svg ? (
              <Svg source={graphSvg(r, width, node)} alt={`${c.sha} ${c.msg}`} width={9 + (width - 1) * 14 + 9} height={30} />
            ) : (
              <Text mono>
                {graphText(r, width, isHead ? '◉' : unpushed ? '○' : c.parents.length > 1 ? '◆' : '●').map((run, k) => (
                  <Text key={`gr-${c.sha}-${k}`} color={run.fg}>{run.t}</Text>
                ))}
              </Text>
            )}
          </Box>
        )
        return (
          <Box key={`lg-${c.sha}`} flexDirection="column">
            <Box alignItems="center" columnGap={sp(v, 1)}>
              {lane}
              <Box flexGrow={1} flexShrink={1}>
                <Button key={`cm-${c.sha}`} plain onPress={() => showCommit($, c.sha)}>
                  <Text wrap="truncate-end">
                    {c.refs.map((ref, k) => chip(ref, `ref-${c.sha}-${k}`))}
                    {c.refs.length > 0 && <Text> </Text>}
                    <Text color={unpushed ? t.busy : t.text} bold={isHead}>{c.msg}</Text>
                    {own && <Text color={t.accent}>{own.auto ? '  ✦ auto' : '  ✦'}</Text>}
                  </Text>
                </Button>
              </Box>
              <Text color={t.faint} size="footnote" mono>{c.sha}</Text>
              {wide && <Text color={t.faint} size="footnote">{c.when}</Text>}
            </Box>
            {open && (
              <Box flexDirection="column" borderStyle="round" borderColor={t.divider} paddingX={1} marginLeft={2}>
                <Text color={t.dim} size="footnote">{`${c.author} · ${c.when}${unpushed ? ' · not pushed' : ''}${own ? ` · ${own.auto ? 'auto-committed' : 'committed'} by Cockpit` : ''}`}</Text>
                {(s.ui.commitInfo || 'Reading the commit…').split('\n').slice(0, 40).map((l, k) => (
                  <Text key={`ci-${c.sha}-${k}`} color={/\|\s+\d+\s*[+-]*$/.test(l) || / changed, /.test(l) ? t.dim : t.text} size="footnote" mono={/\|/.test(l) || / changed, /.test(l)} wrap="truncate-end">{l || ' '}</Text>
                ))}
              </Box>
            )}
          </Box>
        )
      })}
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
          <Text color={t.ok}>{'● '}</Text>
          <Text color={t.text}>{acct.label}</Text>
          <Text color={t.dim}>{`  ${acct.name} <${acct.email}>${acct.gh ? ` · gh ${acct.gh}` : ''}`}</Text>
        </Text>
      )}
      {!acct && s.accounts.length === 0 && <Text color={t.dim}>No git identity or gh login found yet.</Text>}
      {modify && s.accounts.length > 0 && <Seg v={v} id="acct" value={s.accountId} items={s.accounts.map(a => [a.id, a.label] as [string, string])} onPick={k => useAccount($, k)} />}
      {modify && acct && s.ui.acctRemove !== acct.id && (
        <Box gap={sp(v, 1)} flexWrap="wrap">
          <Button key="acct-apply" label="Use for this repo" plain onPress={() => applyAccount($)} />
          <Button key="acct-remove" label="Remove" plain onPress={() => set($, st => ({ ui: { ...st.ui, acctRemove: acct.id } }))} />
        </Box>
      )}
      {modify && acct && s.ui.acctRemove === acct.id && (
        <Box flexDirection="column">
          <Text color={t.busy} wrap="wrap">
            {`Remove ${acct.label} from this machine? ${[acct.gh && `gh logs out ${acct.gh}`, acct.id === 'global' && `git's global user.name and user.email (${acct.name} <${acct.email}>) are unset`].filter(Boolean).join(', and ') || 'It leaves the saved accounts'}.`}
          </Text>
          <Box gap={sp(v, 1)}>
            <Button key="acct-remove-yes" label="Remove" variant="primary" onPress={() => removeAccount($, acct.id)} />
            <Button key="acct-remove-no" label="Cancel" onPress={() => set($, st => ({ ui: { ...st.ui, acctRemove: '' } }))} />
          </Box>
        </Box>
      )}
      {modify && (
        <Box flexDirection="column">
          <Rule v={{ ...v, w: v.w - 4 }} />
          <Text color={t.dim} size="footnote">Add a GitHub login to this machine's gh: paste a classic token (scopes repo, read:org), or log in with gh in your browser.</Text>
          <Box columnGap={sp(v, 1)} flexWrap="wrap">
            <Input key="gh-token" label="Token" placeholder="ghp_…" value={s.ui.ghToken} onInput={val => set($, st => ({ ui: { ...st.ui, ghToken: val } }))} onSubmit={val => ghLoginToken($, val)} />
            <Button key="gh-token-go" label="Add token" onPress={() => ghLoginToken($, s.ui.ghToken)} />
            <Button key="gh-web" label="Log in with gh" onPress={() => ghLoginWeb($)} />
          </Box>
        </Box>
      )}
      {s.ui.ghNote !== '' && <Text color={t.busy} wrap="wrap">{s.ui.ghNote}</Text>}
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
          <Text key={`st-${i}`} color={i === step ? t.accent : i < step ? t.ok : t.dim} bold={i === step}>{`${i < step ? '✓' : '○'} ${name}`}</Text>
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
    <Text key={`dot-${d.id}-${i}`} color={v < 0 ? t.faint : v === top ? t.ok : t.dim}>{v < 0 || v !== top ? '○' : '●'}</Text>
  ))
}
