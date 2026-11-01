import type { ElementTable, EngineInterface, RenderNode } from 'claude-code'

import type { Account, Agent, Decision, GitForm, Ph, Tab, ThemeId } from '../../types'
import {
  inBackground,
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
} from '../actions'
import {
  AGENT_TYPES,
  stepWords,
  planProgress,
  similarRuns,
  recallOf,
  neuralSvg,
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
} from '../logic'
import type { IconState, Neuron } from '../logic'
import { featureLayers, featureMapSvg, features as featureList, impactOf, isTestFeature, memberOf, memoryKey } from '../memory'
import type { FeatureMark } from '../memory'
import { loadRules, pickFlow, resumeAutopilot, setGit as setGitPref, startAutopilot, stopAutopilot, writeInstructions, writeSettings } from '../actions'
import { HOOK_EVENTS, PERM_KINDS, changeHook, changePerm, changeRule, hookRows, parseSettings, permRows, ruleLines } from '../rules'
import type { PermKind } from '../rules'
import { THEMES, THEME_IDS, ctxShades } from '../theme'
import type { Theme } from '../theme'
import type { $, UI, V } from './shared'
import { sp, Bar, Tracker, Segs, pad, cut, Seg, Check, Rule, kindColor, Head, MapText, Card, seatDots } from './shared'

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
              <Button key="needs-commit" label="Commit" variant="primary" onPress={() => inBackground($, 'commit', 'Committing', () => confirmPending($))} />
              <Button key="needs-skip" label="Skip" onPress={() => skipPending($)} />
            </Box>
          )}
        </Box>
      )}
      {s.autopilot && (() => {
        const ap = s.autopilot
        const live = ap.status === 'running'
        const spent = Math.max(0, s.cost - ap.costAt)
        const col = live ? t.busy : ap.status === 'done' ? t.ok : ap.status === 'paused' ? t.accent : t.dim
        return (
          <Box flexDirection="column" borderStyle={live ? 'round' : undefined} borderColor={live ? t.busy : undefined} paddingX={live ? 1 : 0}>
            <Box justifyContent="space-between" alignItems="center" columnGap={sp(v, 1)}>
              <Text size="footnote" bold>
                <Text color={col}>{`⟳ AUTOPILOT · ${ap.status === 'running' ? `CYCLE ${ap.cycle}` : ap.status.toUpperCase()}`}</Text>
              </Text>
              <Box columnGap={sp(v, 1)}>
                {live ? (
                  <Button key="ap-stop" plain onPress={() => stopAutopilot($, 'stopped', 'you stopped it')}>
                    <Text color={t.bad} size="footnote">■ Stop</Text>
                  </Button>
                ) : ap.status !== 'done' ? (
                  <Button key="ap-resume" plain onPress={() => resumeAutopilot($)}>
                    <Text color={t.accent} size="footnote">▶ Resume</Text>
                  </Button>
                ) : null}
                {!live && (
                  <Button key="ap-clear" plain onPress={() => set($, { autopilot: undefined })}>
                    <Text color={t.faint} size="footnote">×</Text>
                  </Button>
                )}
              </Box>
            </Box>
            <Text color={t.text} wrap="wrap">{ap.goal}</Text>
            {ap.total > 0 && (
              <Box columnGap={sp(v, 1)} alignItems="center">
                <Bar ui={v.ui} w={14} frac={ap.done / ap.total} fill={t.ok} track={t.track} />
                <Text color={t.dim} size="footnote">{`${ap.done} of ${ap.total} milestones`}</Text>
              </Box>
            )}
            <Text size="footnote" wrap="wrap">
              <Text color={t.dim}>{`$${spent.toFixed(2)}${ap.budget ? ` of $${ap.budget}` : ', no budget'} · ${fmt(v.now - ap.at)}${ap.hours ? ` of ${ap.hours}h` : ''}`}</Text>
              {live && ap.next !== '' && <Text color={t.faint}>{`  ·  next: ${ap.next}`}</Text>}
              {!live && ap.why !== '' && <Text color={col}>{`  ·  ${ap.why}`}</Text>}
            </Text>
          </Box>
        )
      })()}
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
      {(() => {
        // The agents at this task (at work, or done this flow) and what is remembered from similar earlier tasks
        const busy = s.agents.filter(a => a.status === 'running')
        const ran = cur ? s.agents.filter(a => a.status !== 'running' && a.startedAt >= cur.startedAt) : []
        const mem = s.task ? similarRuns(s.task, [...s.pastAgents, ...s.agents.filter(a => !cur || a.startedAt < cur.startedAt)]) : []
        if (!busy.length && !ran.length && !mem.length) return null
        const lineOf = (a: Agent) => {
          const pp = planProgress(a.plan)
          return a.status === 'running' ? pp.now || stepWords(a.log[a.log.length - 1]?.t) : recallOf(a) || a.status
        }
        const neurons: Neuron[] = [
          ...[...busy, ...ran.slice(-4)].map(a => {
            const pp = planProgress(a.plan)
            return { id: a.id, name: a.name, line: lineOf(a), state: a.status === 'running' ? ('running' as const) : a.status === 'done' ? ('done' as const) : ('failed' as const), ...(pp.total ? { pct: pp.done / pp.total } : {}), ...(a.for ? { link: a.for } : {}) }
          }),
          ...mem.map(m => {
            const kin = busy.find(a => a.type === m.run.type)
            return { id: `mem-${m.run.id}`, name: m.run.name, line: `remembers: ${recallOf(m.run)}`, state: 'memory' as const, ...(kin ? { link: kin.id } : {}) }
          }),
        ]
        return (
          <Box flexDirection="column">
            <Box justifyContent="space-between" alignItems="center" columnGap={sp(v, 1)}>
              <Label label="Agents" n={busy.length} />
              <Button key="ov-agents" plain onPress={() => set($, { tab: 'agents' })}>
                <Text color={t.accent} size="footnote">{`${ran.length ? `${ran.length} finished · ` : ''}${mem.length ? `${mem.length} remembered · ` : ''}Open Agents ›`}</Text>
              </Button>
            </Box>
            {Svg ? (
              <Svg source={neuralSvg(s.task, neurons, { accent: t.accent, busy: t.busy, ok: t.ok, bad: t.bad, text: t.text, dim: t.dim, track: t.divider, bg: /^#/.test(t.surface) ? t.surface : s.isDarkTerm ? '#262624' : '#f5f4ef' }, Math.max(320, w * 8))} alt={`Agents: ${busy.length} at work, ${mem.length} remembered`} isInteractive />
            ) : (
              busy.slice(0, 4).map(a => (
                <Box key={`ova-${a.id}`} columnGap={sp(v, 1)} alignItems="center">
                  {/* One width for the glyph and name, so the trackers' bars start in one column */}
                  <Box width="28%" flexShrink={0}>
                    <Text wrap="truncate-end">
                      <Text color={t.busy}>{`${expertGlyph(a.type)} `}</Text>
                      <Text color={t.text}>{a.name}</Text>
                    </Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1}>
                    <Tracker v={v} a={a} />
                  </Box>
                  <Text color={t.faint} size="footnote">{fmt(v.now - a.startedAt)}</Text>
                </Box>
              ))
            )}
            {!Svg && busy.length > 4 && <Text color={t.faint} size="footnote">{`+ ${busy.length - 4} more running`}</Text>}
            {!Svg && mem.map(m => (
              <Text key={`ovm-${m.run.id}`} size="footnote" wrap="truncate-end">
                <Text color={t.faint}>{'◌ remembers '}</Text>
                <Text color={t.dim}>{`${m.run.name}: ${recallOf(m.run)}`}</Text>
              </Text>
            ))}
          </Box>
        )
      })()}
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
              <Button key="ctx-compact" plain onPress={() => inBackground($, 'compact', 'Compacting', () => compactNow($))}>
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
