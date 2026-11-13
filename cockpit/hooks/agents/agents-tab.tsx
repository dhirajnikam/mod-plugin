
import type { Agent } from '../../types'
import type { $ } from '../core/core'
import { set, setUi, inBackground } from '../core/core'
import { featureMapSvg } from '../memory/memory-map'
import type { IconState } from './agents-view'
import { agentGraph, STATUS_WORD, agentIconSvg, startedBy, providedBy } from './agents-view'
import { AGENT_TYPES, EXPERTS, expertName, expertGlyph, PIPELINES, TESTERS, reportPart, passedOf } from './experts'
import { fmt, plural } from '../core/text'
import { rerun, testAgent, stopAgent, startPipeline, stopAll, createAgent, spawnAgent, runMany, runExpert, clearFinished } from './agents'
import { bringBack, removeWorktree } from './worktrees-io'
import { startAutopilot } from '../judges/autopilot'
import type { V } from '../ui/shared'
import { sp, grow, Bar, Seg, Rule, Check, Head, Fold, More, svgColors, svgWidth } from '../ui/shared'
import { planProgress } from '../flows/flows'
import { stepWords } from '../flows/tools'
import { MapText } from '../memory/activity-tab'

// One agent's tracker: its task list as a bar with done of all and the task it is on; without a list, its current step
export function Tracker({ v, a }: { v: V; a: Agent }) {
  const { Box, Text } = v.ui
  const { t } = v
  const pp = planProgress(a.plan)
  const step = stepWords(a.log[a.log.length - 1]?.t)
  if (!pp.total) return <Text color={t.busy} size="footnote" wrap="truncate-end">{step}</Text>
  return (
    <Box columnGap={sp(v, 1)} alignItems="center">
      <Bar ui={v.ui} w={10} frac={pp.done / pp.total} fill={t.ok} track={t.track} />
      <Text size="footnote" wrap="truncate-end">
        <Text color={t.dim}>{`${pp.done}/${pp.total}  `}</Text>
        <Text color={t.busy}>{pp.now || step}</Text>
      </Text>
    </Box>
  )
}

function AgentMap($: $, v: V, agents: Agent[]) {
  const { Box, Text, Svg } = v.ui
  const { s, t } = v
  if (agents.length < 1) return null
  const { nodes, marks } = agentGraph(agents)
  const open = !s.ui.collapsed['ag-map']
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" alignItems="center" columnGap={sp(v, 1)} flexWrap="wrap">
        <Fold v={v} id="ag-map" open={open} label="Connections" n={agents.length} onPress={() => setUi($, ui => ({ collapsed: { ...ui.collapsed, 'ag-map': open } }))} />
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
        <Svg source={featureMapSvg(nodes, marks, svgColors(v), svgWidth(v))} alt={`Agent connections: ${agents.length} agents`} isInteractive />
      ) : (
        <MapText v={v} nodes={nodes} marks={marks} />
      ))}
    </Box>
  )
}

// Agents: the pipelines in one row, a running pipeline as a strip of icons, and the runs at work. Under More: the
// autopilot and new-agent forms, the connections, the team as one row per agent (icon, name, what it does, ▶ ✎ □),
// the finished runs and the settings
export function Agents($: $, v: V) {
  const { Box, Button, Input, Select, Svg, Text } = v.ui
  const { s, t } = v
  const types = s.agentTypes.length ? s.agentTypes : AGENT_TYPES
  // An agent's last run, since you last cleared the list (a cleared one, or an earlier session's from before, is not shown)
  const shown = (a: Agent) => !s.cleared.includes(a.id) && (a.status === 'running' || (a.endedAt ?? a.startedAt) > s.clearedAt)
  const latestOf = (type: string) => [...s.pastAgents, ...s.agents].filter(a => a.type === type && shown(a)).pop()
  const pipe = s.pipeline
  const running = s.agents.filter(a => a.status === 'running').length
  const team = [...EXPERTS.map(x => ({ type: x.type, name: x.name, what: x.what })), ...s.custom]
  const stateOf = (a?: Agent): IconState => (!a ? 'idle' : a.status === 'running' ? 'running' : a.status === 'failed' || a.cases.some(c => c.st === 'fail') ? 'failed' : a.status === 'stopped' ? 'stopped' : 'done')
  const colorOf = (st: IconState) => (st === 'running' ? t.busy : st === 'done' ? t.ok : st === 'failed' ? t.bad : st === 'idle' ? t.accent : t.dim)
  const spin = ['◐', '◓', '◑', '◒'][Math.floor(v.now / 200) % 4] ?? '◐'
  const icon = (type: string, st: IconState, size: number) =>
    Svg ? (
      <Svg source={agentIconSvg(type, st)} alt={`${expertName(type)}: ${st}`} width={size} height={size} />
    ) : (
      <Text color={colorOf(st)} bold>{st === 'running' ? spin : expertGlyph(type)}</Text>
    )
  const word = (a: Agent) => STATUS_WORD[a.status]
  const took = (a: Agent) => fmt((a.endedAt ?? v.now) - a.startedAt)
  const reportOf = (a?: Agent) => (a ? reportPart(a.report, 'REPORT') : '')
  const testsOf = (id: string) => {
    const mine = [...s.pastAgents, ...s.agents].filter(x => x.for === id && shown(x))
    return { pos: mine.filter(x => x.type === TESTERS[0]).pop(), neg: mine.filter(x => x.type === TESTERS[1]).pop() }
  }
  const verdict = (x: Agent | undefined, label: string, sign: string, waiting: boolean) => {
    if (!x) return waiting ? { t: `${sign} ${label} waiting`, c: t.faint } : undefined
    if (x.status === 'running') return { t: `${spin} ${label} testing`, c: t.busy }
    const fail = x.cases.filter(c => c.st === 'fail').length
    if (x.status !== 'done') return { t: `${sign} ${label} ${word(x).toLowerCase()}`, c: t.bad }
    return { t: x.cases.length ? `${sign} ${label} ${passedOf(x.cases)}/${x.cases.length}` : `${sign} ${label} ${word(x).toLowerCase()}`, c: fail ? t.bad : t.ok }
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
  const instructions = (target: string, hint: string) => {
    const run = (val = s.ui.rerunText) => rerun($, target, val)
    return (
    <Box key={`rr-${target}`} flexDirection="column" paddingLeft={4}>
      <Input
        key="rerun-input"
        label="Instructions"
        placeholder={hint}
        value={s.ui.rerunText}
        rows={grow(v, s.ui.rerunText, 'Instructions')}
        submitLabel="run"
        onInput={val => setUi($, { rerunText: val })}
        onSubmit={val => run(val)}
      />
      <Box columnGap={sp(v, 1)}>
        {pill('rerun-go', '▶ Run with these', true, () => run())}
        {pill('rerun-cancel', 'Cancel', false, () => setUi($, { rerunFor: '', rerunText: '' }))}
      </Box>
    </Box>
    )
  }
  // A button: the surface's own on desktop; on the terminal a filled chip, as the tabs are, in place of [ brackets ]
  const pill = (key: string, label: string, on: boolean, onPress: () => unknown) =>
    v.desk ? (
      <Button key={key} label={label} variant={on ? 'primary' : 'secondary'} onPress={onPress} />
    ) : (
      <Button key={key} label={label} plain onPress={onPress}>
        <Text backgroundColor={on ? t.accent : t.track} color={on ? t.bg || 'inverseText' : t.text} bold={on}>{` ${label} `}</Text>
      </Button>
    )
  const runRow = (a: Agent) => {
              const open = s.ui.openAgent === a.id
              const st = stateOf(a)
              const live = st === 'running'
              const failing = a.cases.filter(c => c.st === 'fail')
              return (
                <Box key={`ag-${a.id}`} flexDirection="column">
                  <Box alignItems={v.desk ? 'center' : 'flex-start'} columnGap={sp(v, 1)}>
                    <Box flexShrink={0}>{icon(a.type, st, 28)}</Box>
                    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                      <Button key={`agb-${a.id}`} plain onPress={() => setUi($, { openAgent: open ? '' : a.id })}>
                        <Text color={t.text} bold wrap="truncate-end">{`${a.name} ${open ? '⌄' : '›'}`}</Text>
                      </Button>
                      {a.for !== undefined && <Text color={t.dim} size="footnote" wrap="truncate-end">{`testing the ${s.agents.find(x => x.id === a.for)?.name ?? 'agent'}'s work`}</Text>}
                      {/* A finished run says what it found (its REPORT line), or else what it was asked */}
                      {live ? <Tracker v={v} a={a} /> : (!a.for || reportOf(a)) && <Text color={t.dim} size="footnote" wrap="truncate-end">{reportOf(a) || a.task}</Text>}
                      {a.pick && <Text color={t.faint} size="footnote" wrap="truncate-end">{a.pick}</Text>}
                      {testLine(a.id, `rl-${a.id}`)}
                      {a.worktree && (
                        <Text color={t.dim} size="footnote" wrap="truncate-end">
                          {`⎇ ${a.worktree.branch || 'its own worktree'}${a.worktree.files ? ` · ${plural(a.worktree.files.length, 'file')} +${a.worktree.add ?? 0} −${a.worktree.del ?? 0}` : live ? ' · working in its own worktree' : ''}${a.worktree.back ? ' · brought back' : ''}${a.worktree.nothing ? ' · changed nothing (Claude Code removed its worktree)' : a.worktree.removed ? ' · removed, branch kept' : ''}`}
                        </Text>
                      )}
                    </Box>
                    <Text size="footnote" wrap="truncate-end">
                      {/* The count stands for the result only when the run finished; a stopped or failed run says so first */}
                      {!live && <Text color={colorOf(st)}>{`${a.status !== 'done' || !a.cases.length ? `${word(a)} · ` : ''}${a.cases.length ? `${passedOf(a.cases)}/${a.cases.length} passed · ` : ''}`}</Text>}
                      <Text color={live ? t.busy : t.dim}>{`${plural(a.tools, 'tool call')} · ${took(a)}`}</Text>
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
                    <Button key={`redo-${a.id}`} plain onPress={() => setUi($, ui => ({ rerunFor: ui.rerunFor === a.id ? '' : a.id, rerunText: '' }))}>
                      <Text color={t.faint}>✎</Text>
                    </Button>
                  </Box>
                  {a.worktree && !live && !a.worktree.removed && (
                    // Both change files: each asks first
                    s.ui.wtAsk === `back:${a.id}` || s.ui.wtAsk === `rm:${a.id}` ? (
                      <Box columnGap={sp(v, 1)} flexWrap="wrap">
                        <Text color={t.busy} size="footnote">{(s.ui.wtAsk ?? '').startsWith('back') ? 'Apply its changes to your files?' : 'Remove the worktree (its branch stays)?'}</Text>
                        <Button key={`wt-yes-${a.id}`} plain onPress={() => ((s.ui.wtAsk ?? '').startsWith('back') ? inBackground($, 'wt', 'Bringing the work back', () => bringBack($, a.id)) : inBackground($, 'wt', 'Removing the worktree', () => removeWorktree($, a.id)))}>
                          <Text color={t.bad} size="footnote">{(s.ui.wtAsk ?? '').startsWith('back') ? 'Bring back' : 'Remove'}</Text>
                        </Button>
                        <Button key={`wt-no-${a.id}`} plain onPress={() => setUi($, { wtAsk: '' })}>
                          <Text color={t.dim} size="footnote">Keep</Text>
                        </Button>
                      </Box>
                    ) : (
                      <Box columnGap={sp(v, 2)} flexWrap="wrap">
                        {!a.worktree.back && (
                          <Button key={`wt-back-${a.id}`} plain onPress={() => setUi($, { wtAsk: `back:${a.id}` })}>
                            <Text color={t.accent} size="footnote">⇲ Bring back</Text>
                          </Button>
                        )}
                        <Button key={`wt-rm-${a.id}`} plain onPress={() => setUi($, { wtAsk: `rm:${a.id}` })}>
                          <Text color={t.dim} size="footnote">Remove worktree</Text>
                        </Button>
                      </Box>
                    )
                  )}
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
                      <Text color={t.faint} size="footnote" wrap="wrap">{[a.type, `started by ${startedBy(a, s.agents)}`, `provided by ${providedBy(a)}`].join(' · ')}</Text>
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
    return Promise.all([startAutopilot($, goal, Number(s.ui.apBudget) || 0, Number(s.ui.apHours) || 0, s.ui.apRole ?? 'task'), set($, st => ({ tab: 'overview', ui: { ...st.ui, apOpen: false } }))])
  }
  // Enter runs a form with the text as typed, its button with the text the state holds
  const create = (val = s.ui.describe) => (val.trim() ? inBackground($, 'agent', 'Making the agent', () => createAgent($, val.trim())) : undefined)
  const spawn = (val = s.ui.spawnTask) => (val.trim() ? spawnAgent($, val.trim(), s.ui.spawnType) : undefined)
  const useType = (val: string) => setUi($, { spawnTypeText: val, spawnType: val.trim() || (types[0] ?? 'general-purpose') })
  const runSelected = (val = s.ui.runTask) => runMany($, Object.keys(s.ui.selected).filter(k => s.ui.selected[k]), val.trim())

  const lastRun = s.agents.filter(a => a.status === 'done' && shown(a)).pop()
  const found = lastRun ? lastRun.cases.filter(c => c.st === 'fail').length : 0
  const state = [
    running > 0 ? `${plural(running, 'agent')} running` : 'No agents running',
    lastRun ? (found > 0 ? `${lastRun.name} found ${plural(found, 'issue')}` : `${lastRun.name} done`) : '',
  ].filter(Boolean).join(' · ')
  const moreOpen = !!s.ui.collapsed['ag-more']
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      <Text color={t.text} bold wrap="wrap">{state}</Text>
      <Box flexWrap="wrap" columnGap={sp(v, 1)}>
        {PIPELINES.map(p => pill(`pipe-${p.name}`, `▶ ${p.label}`, false, () => startPipeline($, p.name)))}
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
                    return ran?.cases.length ? <Text color={fail ? t.bad : t.ok} size="footnote">{`${fail ? '✗' : '✓'}${passedOf(ran.cases)}/${ran.cases.length}`}</Text> : null
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
              <Text color={t.dim}>{reportPart(pipe.reports[pipe.reports.length - 1] ?? '', 'HANDOFF') || 'report handed on'}</Text>
            </Text>
          )}
        </Box>
      )}
      {live_.length > 0 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Head v={v} label="Running" n={live_.length} />
            <Button key="stop-all" plain onPress={() => stopAll($)}>
              <Text color={t.dim} size="footnote">■ Stop all</Text>
            </Button>
          </Box>
          {live_.map(runRow)}
        </Box>
      )}
      <More v={v} id="fold-more-agents" open={moreOpen} onPress={() => setUi($, ui => ({ collapsed: { ...ui.collapsed, 'ag-more': !ui.collapsed['ag-more'] } }))} />
      {moreOpen && (
        <Box flexDirection="column" gap={sp(v, 2)}>
          <Box flexWrap="wrap" columnGap={sp(v, 1)}>
            {pill('ap-toggle', s.ui.apOpen ? '✕ Close' : '⟳ Autopilot', false, () => setUi($, ui => ({ apOpen: !ui.apOpen })))}
            {pill('spawn-toggle', s.ui.spawnOpen ? '✕ Close' : '+ New agent', false, () => setUi($, ui => ({ spawnOpen: !ui.spawnOpen })))}
          </Box>
      {s.ui.apOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
          <Seg v={v} id="ap-role" value={s.ui.apRole ?? 'task'} items={[['task', '⟳ Task'], ['product', '◈ Product owner']]} onPick={k => setUi($, { apRole: k as 'task' | 'product' })} />
          <Input key="ap-goal" label={s.ui.apRole === 'product' ? 'Vision' : 'Goal'} placeholder={s.ui.apRole === 'product' ? 'The fastest offline-first notes app for teams' : 'Add offline sync, with tests, and keep the app fast'} value={s.ui.apGoal ?? ''} rows={grow(v, s.ui.apGoal, 'Goal')} submitLabel="start" onInput={val => setUi($, { apGoal: val })} onSubmit={() => startFromForm()} />
          <Box columnGap={sp(v, 2)} flexWrap="wrap" alignItems="center">
            <Input key="ap-budget" label="Budget $" placeholder="none" value={s.ui.apBudget ?? ''} submitLabel="start" onInput={val => setUi($, { apBudget: val })} onSubmit={() => startFromForm()} />
            <Input key="ap-hours" label="Hours" placeholder="none" value={s.ui.apHours ?? ''} submitLabel="start" onInput={val => setUi($, { apHours: val })} onSubmit={() => startFromForm()} />
            <Button key="ap-go" label={s.ui.apRole === 'product' ? 'Start product owner' : 'Start task'} variant="primary" onPress={() => startFromForm()} />
          </Box>
          <Text color={t.dim} size="footnote" wrap="wrap">
            {s.ui.apRole === 'product'
              ? 'Each round the product owner studies the product and where its field is going, proposes the next goals, and the judges pick one; the task builds it, then the next round starts. It runs until you stop it or a limit is hit, and never pushes or publishes.'
              : 'Claude works cycle after cycle from a roadmap in .cockpit/roadmap.md, each cycle told what the earlier ones did, until the judges agree the goal is reached. Leave budget and hours empty to run until it is done; it pauses for you on anything hard to undo, and after three cycles that change nothing.'}
          </Text>
        </Box>
      )}
      {s.ui.spawnOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
          <Input
            key="describe"
            label="Describe the agent"
            placeholder="Checks every API change for breaking changes and missing docs"
            value={s.ui.describe}
            rows={grow(v, s.ui.describe, 'Describe the agent')}
            submitLabel="create"
            onInput={val => setUi($, { describe: val })}
            onSubmit={val => create(val)}
          />
          <Box columnGap={sp(v, 2)} flexWrap="wrap" alignItems="center">
            <Button key="describe-go" label={s.creating ? 'Making the agent…' : 'Create agent'} variant="primary" onPress={() => (s.creating ? undefined : create())} />
            <Text color={t.dim} size="footnote" wrap="wrap">{s.creating ? `${spin} writing its definition` : 'Joins the team, kept for later sessions'}</Text>
          </Box>
          <Rule v={{ ...v, w: v.w - 4 }} />
          <Text color={t.dim} size="footnote">Or run a task now with any agent type</Text>
          <Input
            key="spawn-task"
            label="Task"
            placeholder="Document the 429 response in the API guide"
            value={s.ui.spawnTask}
            rows={grow(v, s.ui.spawnTask, 'Task')}
            submitLabel="start"
            onInput={val => setUi($, { spawnTask: val })}
            onSubmit={val => spawn(val)}
          />
          <Box columnGap={sp(v, 2)} flexWrap="wrap">
            <Select key="spawn-type" label="Type" value={s.ui.spawnType} options={[...types, ...(types.includes(s.ui.spawnType) ? [] : [s.ui.spawnType])].map(a => ({ value: a, label: a }))} onSelect={val => setUi($, { spawnType: val, spawnTypeText: '' })} />
            <Input key="spawn-type-custom" label="or any type" placeholder="my-plugin:reviewer" value={s.ui.spawnTypeText ?? ''} submitLabel="use" onInput={val => useType(val)} onSubmit={val => useType(val)} />
            <Button key="spawn-go" label="Start" onPress={() => spawn()} />
          </Box>
          <Check v={v} id="spawn-wt" on={!!s.ui.agentWorktree} label="In its own worktree (its own branch; bring its work back when you choose)" onPress={() => setUi($, ui => ({ agentWorktree: !ui.agentWorktree }))} />
        </Box>
      )}
      {Object.values(s.ui.selected).some(Boolean) && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.accent} paddingX={1}>
          <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Text color={t.text} bold>{`${Object.values(s.ui.selected).filter(Boolean).length} selected · run them at once`}</Text>
            <Box columnGap={sp(v, 1)}>
              {pill('run-selected', '▶ Run selected', true, () => runSelected())}
              {pill('pick-none', 'Clear', false, () => setUi($, { selected: {} }))}
            </Box>
          </Box>
          <Input
            key="run-task"
            label="Task for them"
            placeholder={s.task ? `the current task: ${s.task.slice(0, 60)}` : 'what they should work on'}
            value={s.ui.runTask}
            rows={grow(v, s.ui.runTask, 'Task for them')}
            submitLabel="run"
            onInput={val => setUi($, { runTask: val })}
            onSubmit={val => runSelected(val)}
          />
        </Box>
      )}
      {AgentMap($, v, [...s.agents.filter(a => a.status === 'running'), ...done_.slice(0, 8)].filter(a => !s.cleared.includes(a.id)))}
      <Box flexDirection="column" gap={sp(v, 1)}>
        <Head v={v} label="Team" note={`${team.length} agents`} />
        <Check v={v} id="team-wt" on={!!s.ui.agentWorktree} label="Runs in their own worktree" onPress={() => setUi($, ui => ({ agentWorktree: !ui.agentWorktree }))} />
        {team.map(x => {
          const a = latestOf(x.type)
          const st = stateOf(a)
          const live = st === 'running'
          const copies = s.agents.filter(r => r.type === x.type && r.status === 'running')
          // The roster says what each expert does; its runs and their results are listed once, under Running and
          // Finished, and the row points there
          const right = !a || live ? '' : `${(st === 'failed' ? STATUS_WORD.failed : word(a)).toLowerCase()} ↓`
          const ticked = !!s.ui.selected[x.type]
          const rowEl = (
            <Box key={`ex-${x.type}`} alignItems={v.desk ? 'center' : 'flex-start'} columnGap={sp(v, 1)}>
              <Box flexShrink={0}>{icon(x.type, st, 28)}</Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text color={t.text} bold wrap="truncate-end">{x.name}</Text>
                <Text color={t.dim} size="footnote" wrap="truncate-end">{x.what}</Text>
              </Box>
              {right !== '' && <Box flexShrink={0}><Text color={colorOf(st)} size="footnote">{right}</Text></Box>}
              {live && <Box flexShrink={0}><Text color={t.faint} size="footnote">{`running${copies.length > 1 ? ` ×${copies.length}` : ''} ↑`}</Text></Box>}
              <Button key={`run-${x.type}`} plain onPress={() => runExpert($, x.type)}>
                <Text color={live ? t.faint : t.dim}>▶</Text>
              </Button>
              <Button key={`edit-${x.type}`} plain onPress={() => setUi($, ui => ({ rerunFor: ui.rerunFor === `type:${x.type}` ? '' : `type:${x.type}`, rerunText: '' }))}>
                <Text color={t.faint}>✎</Text>
              </Button>
              <Button key={`pick-${x.type}`} plain onPress={() => setUi($, ui => ({ selected: { ...ui.selected, [x.type]: !ui.selected[x.type] } }))}>
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
            <Fold v={v} id="fold-finished" open={allDone || done_.length <= 3} label="Finished" n={done_.length} onPress={() => setUi($, ui => ({ collapsed: { ...ui.collapsed, 'ag-finished': !allDone } }))} />
            <Button key="clear-finished" plain onPress={() => clearFinished($)}>
              <Text color={t.dim} size="footnote">Clear</Text>
            </Button>
          </Box>
          {(allDone ? done_ : done_.slice(0, 3)).map(runRow)}
          {!allDone && done_.length > 3 && <Text color={t.faint} size="footnote">{`+ ${done_.length - 3} earlier`}</Text>}
        </Box>
      )}
      <Box flexDirection="column">
        <Fold v={v} id="fold-settings" open={!!s.ui.collapsed['ag-settings']} label="Settings" note={`both testers ${s.testAgents ? 'on' : 'off'} · verify each turn ${s.autoVerify ? 'on' : 'off'} · notices ${s.notifyDone !== false ? 'on' : 'off'}`} onPress={() => setUi($, ui => ({ collapsed: { ...ui.collapsed, 'ag-settings': !ui.collapsed['ag-settings'] } }))} />
        {s.ui.collapsed['ag-settings'] && <Check v={v} id="testagents" on={s.testAgents} label="Test each agent's work: a positive and a negative tester" onPress={() => set($, st => ({ testAgents: !st.testAgents }))} />}
        {s.ui.collapsed['ag-settings'] && <Check v={v} id="choosemodel" on={s.chooseModel} label="Choose model and effort for me" onPress={() => set($, st => ({ chooseModel: !st.chooseModel }))} />}
        {s.ui.collapsed['ag-settings'] && <Check v={v} id="autoverify" on={s.autoVerify} label="Verify after each turn that changes files" onPress={() => set($, st => ({ autoVerify: !st.autoVerify }))} />}
        {s.ui.collapsed['ag-settings'] && <Check v={v} id="notify-done" on={s.notifyDone !== false} label="Tell me when work is done (while I am not watching this pane; a daily budget warns regardless)" onPress={() => set($, st => ({ notifyDone: st.notifyDone === false }))} />}
      </Box>
        </Box>
      )}
    </Box>
  )
}
