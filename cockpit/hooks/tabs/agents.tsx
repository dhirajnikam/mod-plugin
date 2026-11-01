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

// The agents and who started them, as a diagram: you, Claude and Cockpit on top, an arrow from each to the agents it
// started (a pipeline's steps under Cockpit), a tester's arrow to the agent whose work it tests, an agent's to the ones
// it started. Running ones are filled and breathe, finished ones outlined; ↗ marks an agent from outside Cockpit
// (Claude's own types, another plugin's). Hovering a box says its task, state, who started it and who provides it
export function agentGraph(agents: Agent[]) {
  const label = new Map<string, string>()
  const seen: Record<string, number> = {}
  for (const a of agents) {
    const outside = a.provider ? a.provider !== 'cockpit' : !a.type.startsWith('cockpit:')
    const base = `${outside ? '↗ ' : ''}${a.name}`
    seen[base] = (seen[base] ?? 0) + 1
    label.set(a.id, seen[base] > 1 ? `${base} #${seen[base]}` : base)
  }
  const by = (a: Agent) => (a.by === 'agent' && a.parent && label.has(a.parent) ? label.get(a.parent)! : a.by === 'you' ? 'You' : a.by === 'pipeline' || (a.by === undefined && a.for) ? 'Cockpit' : 'Claude')
  const nodes = new Map<string, { name: string; uses: string[]; what: string; files: string[]; usedBy: string[] }>()
  const node = (n: string, what = '') => nodes.get(n) ?? (nodes.set(n, { name: n, uses: [], what, files: [], usedBy: [] }), nodes.get(n)!)
  for (const a of agents) {
    const me = node(label.get(a.id)!, [a.task, a.status, `started by ${a.by === 'agent' ? 'an agent' : (a.by ?? 'Claude, outside Cockpit\'s view')}`, `provided by ${a.provider ?? (a.type.includes(':') ? a.type.split(':')[0] : 'Claude Code')}`].filter(Boolean).join('\n'))
    const from = a.for && label.has(a.for) ? null : by(a)
    if (from) node(from).uses.push(me.name)
    if (a.for && label.has(a.for)) me.uses.push(label.get(a.for)!)
  }
  const marks: Record<string, FeatureMark> = {}
  for (const a of agents) marks[label.get(a.id)!] = a.status === 'running' ? 'now' : a.status === 'done' ? 'touched' : 'reached'
  return { nodes: [...nodes.values()], marks }
}

function AgentMap($: $, v: V, agents: Agent[]) {
  const { Box, Button, Text, Svg } = v.ui
  const { s, t, w } = v
  if (agents.length < 1) return null
  const { nodes, marks } = agentGraph(agents)
  const open = !s.ui.collapsed['ag-map']
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" alignItems="center" columnGap={sp(v, 1)}>
        <Button key="ag-map" plain onPress={() => set($, st => ({ ui: { ...st.ui, collapsed: { ...st.ui.collapsed, 'ag-map': open } } }))}>
          <Text size="footnote" bold>
            <Text color={t.faint}>{open ? '⌄ ' : '› '}</Text>
            <Text color={t.dim}>CONNECTIONS</Text>
            <Text color={t.faint}>{` ${agents.length}`}</Text>
          </Text>
        </Button>
        {open && (
          <Text size="footnote">
            <Text color={t.busy}>■</Text>
            <Text color={t.faint}>{' running  '}</Text>
            <Text color={t.accent}>□</Text>
            <Text color={t.faint}>{' done  '}</Text>
            <Text color={t.busy}>┅</Text>
            <Text color={t.faint}>{' stopped or failed  ↗ outside Cockpit'}</Text>
          </Text>
        )}
      </Box>
      {open && (Svg ? (
        <Svg source={featureMapSvg(nodes, marks, { accent: t.accent, busy: t.busy, text: t.text, dim: t.dim, track: t.divider, bg: /^#/.test(t.surface) ? t.surface : s.isDarkTerm ? '#262624' : '#f5f4ef' }, Math.max(320, w * 8))} alt={`Agent connections: ${agents.length} agents`} isInteractive />
      ) : (
        <MapText v={v} nodes={nodes} marks={marks} />
      ))}
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
                      {a.for !== undefined && <Text color={t.dim} size="footnote" wrap="truncate-end">{`testing the ${s.agents.find(x => x.id === a.for)?.name ?? 'agent'}'s work`}</Text>}
                      {live ? <Tracker v={v} a={a} /> : !a.for && <Text color={t.dim} size="footnote" wrap="truncate-end">{a.task}</Text>}
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
                      <Text color={t.faint} size="footnote" wrap="wrap">{[a.type, `started by ${a.by === 'agent' ? `the ${s.agents.find(x => x.id === a.parent)?.name ?? 'agent'}` : a.by === 'you' ? 'you' : a.by === 'pipeline' ? 'a Cockpit pipeline' : a.by === 'claude' ? 'Claude' : 'Claude, outside Cockpit\'s view'}`, `provided by ${a.provider === 'engine' ? 'Claude Code' : a.provider ?? (a.type.includes(':') ? a.type.split(':')[0] : 'Claude Code')}`].join(' · ')}</Text>
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
  const startFromForm = () => {
    const goal = (s.ui.apGoal ?? '').trim()
    if (!goal) return undefined
    return Promise.all([startAutopilot($, goal, Number(s.ui.apBudget) || 0, Number(s.ui.apHours) || 0), set($, st => ({ tab: 'overview', ui: { ...st.ui, apOpen: false } }))])
  }
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
        {pill('ap-toggle', s.ui.apOpen ? '✕ Close' : '⟳ Autopilot', false, () => set($, st => ({ ui: { ...st.ui, apOpen: !st.ui.apOpen } })))}
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
          {(() => {
            const step = s.agents.find(x => x.id === pipe.agentId && x.status === 'running')
            return step ? <Tracker v={v} a={step} /> : null
          })()}
          {pipe.reports.length > 0 && (
            <Text size="footnote" wrap="truncate-end">
              <Text color={t.accent}>{'↳ '}</Text>
              <Text color={t.dim}>{pipe.reports[pipe.reports.length - 1]?.split('\n').find(l => l.startsWith('HANDOFF:'))?.slice(8).trim() || 'report handed on'}</Text>
            </Text>
          )}
        </Box>
      )}
      {s.ui.apOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
          <Input key="ap-goal" label="Goal" placeholder="Add offline sync, with tests, and keep the app fast" value={s.ui.apGoal ?? ''} onInput={val => set($, st => ({ ui: { ...st.ui, apGoal: val } }))} onSubmit={() => startFromForm()} />
          <Box columnGap={sp(v, 2)} flexWrap="wrap" alignItems="center">
            <Input key="ap-budget" label="Budget $" placeholder="none" value={s.ui.apBudget ?? ''} onInput={val => set($, st => ({ ui: { ...st.ui, apBudget: val } }))} onSubmit={() => startFromForm()} />
            <Input key="ap-hours" label="Hours" placeholder="none" value={s.ui.apHours ?? ''} onInput={val => set($, st => ({ ui: { ...st.ui, apHours: val } }))} onSubmit={() => startFromForm()} />
            <Button key="ap-go" label="Start autopilot" variant="primary" onPress={() => startFromForm()} />
          </Box>
          <Text color={t.dim} size="footnote" wrap="wrap">Claude works cycle after cycle from a roadmap in .cockpit/roadmap.md until the judges agree the goal is reached. Leave budget and hours empty to run until it is done; it pauses for you on anything hard to undo, and after three cycles that change nothing.</Text>
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
            onSubmit={val => (val.trim() ? inBackground($, 'agent', 'Making the agent', () => createAgent($, val.trim())) : undefined)}
          />
          <Box columnGap={sp(v, 2)} flexWrap="wrap" alignItems="center">
            <Button key="describe-go" label={s.creating ? 'Making the agent…' : 'Create agent'} variant="primary" onPress={() => (s.ui.describe.trim() && !s.creating ? inBackground($, 'agent', 'Making the agent', () => createAgent($, s.ui.describe.trim())) : undefined)} />
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
      {AgentMap($, v, [...s.agents.filter(a => a.status === 'running'), ...done_.slice(0, 8)].filter(a => !s.cleared.includes(a.id)))}
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
