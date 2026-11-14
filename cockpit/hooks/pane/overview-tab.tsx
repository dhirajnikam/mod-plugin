
import type { Agent, Decision, SessionSpend } from '../../types'
import { progress, FLOWS, planProgress, progressOf, stepNo, autopilotWords } from '../flows/flows'
import { verifyState, similarRuns, recallOf, expertGlyph, passedOf } from '../agents/experts'
import { ctxShades, ctxLevel, ctxColor } from '../core/theme'
import { INITIAL } from '../core/state'
import { STATUS_WORD } from '../agents/agents-view'
import { set, setUi, inBackground } from '../core/core'
import { sessionsNow, spendByDay, budgetLevel, todaySpend, costliest, dayOf } from '../core/spend'
import { tally, thrOf, SEAT_NAMES } from '../judges/judges'
import { stopAutopilot, resumeAutopilot } from '../judges/autopilot'
import { fmt, kTok, plural } from '../core/text'
import { Guide } from '../memory/guide'
import { pickFlow } from '../flows/flows-io'
import { stepWords } from '../flows/tools'
import { turnRef } from '../git/turns'
import { undoFlow } from '../git/turns-io'
import { setBudget } from '../core/notify'
import { compactNow, clearNow } from '../core/session'
import type { $ } from '../core/core'
import type { V } from '../ui/shared'
import { sp, Bar, Seg, kindColor, Segs, Head, Fold, More, Diff, svgColors, svgWidth } from '../ui/shared'
import { Tracker } from '../agents/agents-tab'
import { CommitSkip, prWords } from '../git/git-tab'
import { ringSvg, ringRuns, neuralSvg } from '../ui/svg'
import { openTab } from './tabs'
import type { Neuron } from '../ui/svg'
import { modeOf, MODES } from '../core/modes'

export function Overview($: $, v: V) {
  const { Box, Button, Input, Text, Svg } = v.ui
  const { s, t, w } = v
  const p = progress(s)
  const cur = s.flows[s.flows.length - 1]
  const vs = verifyState(s.agents)
  const err = s.lastError && cur && s.lastError.at >= cur.startedAt ? s.lastError : undefined
  const changed = s.repo.changed.length
  const needs = s.waiting ? 'Claude is waiting for your answer in the chat.' : s.pending ? `Commit "${s.pending.msg}" → ${s.pending.branch}?` : ''
  const adds = s.repo.changed.reduce((a, c) => a + c.add, 0)
  const dels = s.repo.changed.reduce((a, c) => a + c.del, 0)
  const shades = ctxShades(t)
  const used = s.ctx.used
  const win = s.ctx.window || INITIAL.ctx.window
  const decs = s.decisions.slice().reverse()
  // The current flow is the hero under More; these are the ones before it
  const flows = s.flows.slice(0, -1).reverse()
  // Folded sections, kept with the tree's folds: true opens one
  const isOpen = (k: string) => !!s.ui.collapsed[`ov-${k}`]
  const toggle = (k: string) => setUi($, ui => ({ collapsed: { ...ui.collapsed, [`ov-${k}`]: !ui.collapsed[`ov-${k}`] } }))
  // Every section opens with the same small heading; a fold has an arrow, and one with nothing to hide is a plain
  // heading, as an arrow that changes nothing reads as broken
  const Section = ({ k, label, n, can = true }: { k: string; label: string; n?: number; can?: boolean }) => !can ? (
    <Head v={v} label={label} {...(n !== undefined ? { n } : {})} />
  ) : (
    <Fold v={v} id={`fold-${k}`} open={isOpen(k)} label={label} {...(n !== undefined ? { n } : {})} onPress={() => toggle(k)} />
  )
  const ctxCol = ctxColor(t, s.ctx.pct, t.dim)
  const sessions: SessionSpend[] = sessionsNow(s, v.now)
  const days = spendByDay(sessions, v.now, 14)
  const peak = Math.max(0.01, ...days.map(d => d.usd))
  const spent = days.reduce((a, d) => a + d.usd, 0)
  const level = budgetLevel(todaySpend(sessions, v.now), s.dailyBudget)
  const running = s.agents.filter(a => a.status === 'running').length
  const pr = s.repo.pr
  const step = stepNo(p)
  const passed = passedOf(vs.cases)
  const nowLine = [
    s.isWorking ? s.activity : s.flows.length ? 'Idle' : 'Ready',
    step ? `step ${step.n} of ${step.of}` : '',
    running > 0 ? `${plural(running, 'agent')} running` : '',
    `$${todaySpend(sessions, v.now).toFixed(2)} today`,
  ].filter(Boolean).join(' · ')
  const approachLine = (d: Decision) => {
    const tl = tally(d)
    const win = tl.top >= 0 ? d.opts[tl.top] : undefined
    if (d.status === 'you') return `You chose ${d.result.replace(/^You chose · /, '')}: ${d.q}`
    if (d.status === 'decided' && win) {
      const over = d.opts.filter((_, i) => i !== tl.top).slice(0, 2).join(' or ')
      const why = d.reasons?.find((r, i) => d.votes[i] === tl.top && r) ?? ''
      return `Chose ${win}${over ? ` over ${over}` : ''}${why ? ` because ${why.charAt(0).toLowerCase()}${why.slice(1).replace(/\.+$/, '')}` : ''}`
    }
    return `${d.status === 'advised' ? 'Judges advise' : 'Deciding'}: ${d.q}`
  }
  const totals = s.flows.reduce((a, f) => ({ ms: a.ms + ((f.endedAt ?? v.now) - f.startedAt), add: a.add + f.add, del: a.del + f.del, commits: a.commits + (f.commit ? 1 : 0) }), { ms: 0, add: 0, del: 0, commits: 0 })
  return (
    <Box flexDirection="column" gap={v.desk ? 'md' : 1}>
      {needs !== '' && (
        <Box borderStyle="round" borderColor={t.accent} paddingX={1} justifyContent="space-between">
          <Box flexDirection="column">
            <Text color={t.busy} bold>NEEDS YOU</Text>
            <Text color={t.text}>{needs}</Text>
          </Box>
          {s.pending && CommitSkip($, v.ui, 'needs', sp(v, 1))}
        </Box>
      )}
      {s.autopilot && (() => {
        const ap = s.autopilot
        const live = ap.status === 'running'
        const spent = Math.max(0, s.cost - ap.costAt)
        const col = live ? t.busy : ap.status === 'done' ? t.ok : ap.status === 'paused' ? t.accent : t.dim
        const po = ap.role === 'product'
        const scouting = po && ap.phase === 'scout'
        return (
          <Box flexDirection="column" borderStyle={live ? 'round' : undefined} borderColor={live ? t.busy : undefined} paddingX={live ? 1 : 0}>
            <Box justifyContent="space-between" alignItems="center" columnGap={sp(v, 1)}>
              <Text size="footnote" bold>
                <Text color={col}>{autopilotWords(ap).toUpperCase()}</Text>
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
            {po && <Text color={t.dim} size="footnote" wrap="wrap">{`Vision: ${ap.vision ?? ''}${ap.shipped?.length ? `  ·  ${plural(ap.shipped.length, 'goal')} built` : ''}`}</Text>}
            <Text color={t.text} wrap="wrap">{scouting ? 'Studying the product and its field for the next goal; the judges will pick it' : ap.goal}</Text>
            {live && !scouting && (ap.stuck ?? 0) >= 2 && <Text color={t.accent} size="footnote" wrap="wrap">{`${ap.stuck} cycles without a milestone ticked: told to split it or try another way`}</Text>}
            {live && !scouting && !!ap.gaps && <Text color={t.accent} size="footnote" wrap="wrap">{`Judges: not done yet · ${ap.gaps.replace(/^- /gm, '').split('\n').join(' · ')}`}</Text>}
            {!scouting && ap.total > 0 && (
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
      {/* Now: one plain sentence of what Claude is doing, then the few rows that matter */}
      <Box flexDirection="column" gap={sp(v, 1)}>
        <Text color={t.text} bold wrap="wrap">{nowLine}</Text>
        <Box flexDirection="column">
          {changed > 0 && (
            <Box columnGap={sp(v, 1)} flexWrap="wrap">
              <Text color={t.dim}>{`${plural(changed, 'file')} changed`}</Text>
              {(adds || dels) > 0 && <Diff ui={v.ui} t={t} add={adds} del={dels} />}
              <Button key="changed-git" plain onPress={() => openTab($, 'git')}>
                <Text color={t.dim}>Open Git ›</Text>
              </Button>
            </Box>
          )}
      {(vs.cases.length > 0 || vs.running || err) && (
        <Box flexDirection="column">
          <Head v={v} label={err || vs.fail ? 'Checks · failing' : 'Checks'} {...(err || vs.fail ? { color: t.bad } : {})} />
          {err && (
            <Text wrap="wrap">
              <Text color={t.bad}>{`✗ ${err.tool} `}</Text>
              <Text color={t.text}>{err.text}</Text>
              <Text color={t.faint}>{` · ${fmt(v.now - err.at)} ago`}</Text>
            </Text>
          )}
          {(vs.cases.length > 0 || vs.running) && (
            <Text wrap="truncate-end">
              <Text color={t.dim}>Tests </Text>
              {/* Words beside each mark, so a count of passes never reads as the running test's result */}
              {passed > 0 && <Text color={t.ok}>{`✓ ${passed} passed  `}</Text>}
              {vs.fail > 0 && <Text color={t.bad}>{`✗ ${vs.fail} failed  `}</Text>}
              {vs.running ? <Text color={t.busy}>{vs.cases.length ? '· more running' : 'running'}</Text> : vs.fail > 0 && <Text color={t.dim}>{`· ${vs.cases.find(c => c.st === 'fail')?.n ?? ''}`}</Text>}
            </Text>
          )}
        </Box>
      )}
          {running > 0 && (
            <Box columnGap={sp(v, 1)}>
              <Text color={t.dim}>{`${plural(running, 'agent')} running`}</Text>
              <Button key="ov-agents" plain onPress={() => openTab($, 'agents')}>
                <Text color={t.dim}>Open Agents ›</Text>
              </Button>
            </Box>
          )}
          {pr && <Text color={pr.checks.fail > 0 || pr.review === 'changes' ? t.bad : t.dim} wrap="truncate-end">{prWords(pr).line}</Text>}
        </Box>
      </Box>
      {Guide($, v)}
      {p.steps.length > 0 && (
        <Box flexDirection="column">
          <Text color={t.dim}>Steps</Text>
          {p.steps.map((x, i) => (
            <Text key={`step-${i}-${x.name}`} color={x.st === 'active' ? t.text : x.st === 'done' ? t.dim : t.faint} bold={x.st === 'active'} wrap="truncate-end">
              {`${x.st === 'done' ? '✓' : x.st === 'active' ? '◌' : x.st === 'skipped' ? '↷' : '·'} ${x.name}`}
            </Text>
          ))}
        </Box>
      )}
      {decs.length > 0 && (
        <Box flexDirection="column">
          <Text color={t.dim}>Approach</Text>
          {decs.slice(0, 3).map(d => (
            <Text key={`ap-${d.id}`} color={t.text} wrap="wrap">{approachLine(d)}</Text>
          ))}
          {decs.length > 3 && <Text color={t.faint}>{`+ ${decs.length - 3} more under More`}</Text>}
        </Box>
      )}
      <More v={v} id="fold-more" open={isOpen('more')} onPress={() => toggle('more')} />
      {isOpen('more') && (
        <Box flexDirection="column" gap={v.desk ? 'md' : 1}>
      <Box columnGap={sp(v, 2)} flexWrap="wrap">
        {Svg ? (
          <Svg source={ringSvg(p.pct, { accent: t.accent, track: t.track, text: t.text, dim: t.dim })} alt={`${p.pct}% · ${p.stepName}`} width={96} height={96} />
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
            {/* While a turn runs its time is in the header's badge; once it ends, here */}
            {([...(!s.isWorking && s.lastTurnMs ? [['Last turn', fmt(s.lastTurnMs), t.text] as const] : []), ['Cost', `$${s.cost.toFixed(2)}`, t.text] as const]).map(([label, val, c]) => (
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
          <Text key={`step-${i}-${x.name}`} backgroundColor={x.st === 'active' ? t.wash || undefined : (x.st === 'done' && t.surface) || undefined} color={x.st === 'skipped' ? t.faint : x.st === 'pending' ? t.dim : x.st === 'active' ? t.hi : t.text} bold={x.st === 'active'}>
            <Text color={x.st === 'done' ? t.ok : x.st === 'active' ? t.accent : t.faint}>{` ${x.st === 'done' ? '✓' : x.st === 'active' ? '●' : x.st === 'skipped' ? '↷' : '○'}`}</Text>
            {` ${x.name} `}
          </Text>
        ))}
        {/* A skipped step is passed over, not undone: say so once rather than strike it through */}
        {p.steps.some(x => x.st === 'skipped') && <Text color={t.faint} size="footnote">↷ skipped</Text>}
        {s.flows.length > 0 && (
          <Button key="flow-pick" plain onPress={() => toggle('flowpick')}>
            <Text color={t.faint} size="footnote">{`${p.flow.label} flow ${isOpen('flowpick') ? '⌄' : '›'}`}</Text>
          </Button>
        )}
      </Box>
      {s.flows.length > 0 && isOpen('flowpick') && (
        <Box flexDirection="column">
          <Seg v={v} id="flow" value={p.flow.name} items={[...(cur?.plan?.length ? [['plan', 'Plan'] as [string, string]] : []), ...(cur?.steps?.length ? [['task', 'Task'] as [string, string]] : []), ...FLOWS.map(f => [f.name, f.label] as [string, string])]} onPick={k => pickFlow($, k)} />
          <Text color={t.faint} size="footnote">{p.flow.name === 'plan' ? "steps from Claude's task list" : p.flow.name === 'task' ? 'steps written for this task' : `steps from the ${p.flow.label} flow${cur?.kind ? ', your pick' : ''}`}</Text>
        </Box>
      )}
      {(() => {
        const busy = s.agents.filter(a => a.status === 'running')
        const ran = cur ? s.agents.filter(a => a.status !== 'running' && a.startedAt >= cur.startedAt) : []
        const mem = s.task ? similarRuns(s.task, [...s.pastAgents, ...s.agents.filter(a => !cur || a.startedAt < cur.startedAt)]) : []
        if (!busy.length && !ran.length && !mem.length) return null
        const lineOf = (a: Agent) => {
          const pp = planProgress(a.plan)
          return a.status === 'running' ? pp.now || stepWords(a.log[a.log.length - 1]?.t) : recallOf(a) || STATUS_WORD[a.status].toLowerCase()
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
              <Head v={v} label="Agents" n={busy.length} />
              <Button key="ov-agents-more" plain onPress={() => openTab($, 'agents')}>
                <Text color={t.accent} size="footnote">{`${ran.length ? `${ran.length} finished · ` : ''}${mem.length ? `${mem.length} remembered · ` : ''}Open Agents ›`}</Text>
              </Button>
            </Box>
            {Svg ? (
              <Svg source={neuralSvg(s.task, neurons, { ...svgColors(v), ok: t.ok, bad: t.bad }, svgWidth(v))} alt={`Agents: ${busy.length} at work, ${mem.length} remembered`} isInteractive />
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
              <Head v={v} label="Changed files" n={changed} />
              {(adds || dels) > 0 && <Diff ui={v.ui} t={t} add={adds} del={dels} size="footnote" />}
            </Box>
            <Button key="changed-git-more" plain onPress={() => openTab($, 'git')}>
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
              {/* The figures keep their line; the path gives way, cut from its start */}
              {(c.add || c.del) > 0 && (
                <Box flexShrink={0}>
                  <Diff ui={v.ui} t={t} add={c.add} del={c.del} size="footnote" />
                </Box>
              )}
            </Box>
          ))}
          {changed > 5 && <Text color={t.dim} size="footnote">{`+ ${changed - 5} more in Git`}</Text>}
        </Box>
      )}
      {flows.length > 0 && (
        <Box flexDirection="column">
          <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Section k="flows" label="Earlier flows" n={flows.length} can={flows.length > 3} />
            <Text size="footnote">
              <Text color={t.faint}>{`total ${fmt(totals.ms)} · `}</Text>
              <Text color={t.ok}>{`+${totals.add}`}</Text>
              <Text color={t.bad}>{` −${totals.del}`}</Text>
              {totals.commits > 0 && <Text color={t.dim}>{` · ${plural(totals.commits, 'commit')}`}</Text>}
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
                  <Text color={f.status === 'done' ? t.faint : col}>{live ? '●' : f.status === 'done' ? '✓' : '✗'}</Text>
                  <Box flexGrow={1} flexShrink={1}>
                    <Button key={`flb-${f.id}`} plain onPress={() => setUi($, { openFlow: open ? '' : f.id })}>
                      <Text color={t.text} bold={live} wrap="truncate-end">{f.task}</Text>
                    </Button>
                  </Box>
                  <Box flexShrink={0} columnGap={sp(v, 1)}>
                    {(f.turns ?? 1) > 1 && <Text color={t.dim} size="footnote">{`×${f.turns}`}</Text>}
                    {(f.add || f.del) > 0 && <Text color={t.faint} size="footnote">{`+${f.add} −${f.del}`}</Text>}
                    {f.commit !== '' && w >= 60 && <Text color={t.accent} size="footnote" mono>{f.commit}</Text>}
                  </Box>
                </Box>
                {open && (
                  <Box flexDirection="column" paddingLeft={2}>
                    <Text color={t.dim} size="footnote" wrap="wrap">{`${fmt(took)} · ${fp.pct}% · ${fp.flow.label} flow · ${f.reached.join(' › ')}${f.status === 'aborted' ? ' · stopped' : ''}`}</Text>
                    <Text color={t.dim} size="footnote">{`${(f.turns ?? 1) > 1 ? `${f.turns} turns · ` : ''}${f.ops} file operations · ${plural(f.decisions, 'decision')}${f.commit ? ` · committed ${f.commit}` : ' · not committed'}`}</Text>
                    {f.snap?.undone ? (
                      <Text color={t.faint} size="footnote" wrap="wrap">{`↶ undone · the files just before: ${turnRef(f.id, 'undone')}`}</Text>
                    ) : !live && f.snap?.before && f.snap?.after && (
                      // Undo asks first: it changes files in the working tree
                      s.ui.undoAsk === f.id ? (
                        <Box columnGap={sp(v, 1)} flexWrap="wrap">
                          <Text color={t.busy} size="footnote">Undo the files this turn changed?</Text>
                          <Button key={`undo-yes-${f.id}`} plain onPress={() => inBackground($, 'undo', 'Undoing the turn', () => undoFlow($, f.id))}>
                            <Text color={t.bad} size="footnote">Undo</Text>
                          </Button>
                          <Button key={`undo-no-${f.id}`} plain onPress={() => setUi($, { undoAsk: '' })}>
                            <Text color={t.dim} size="footnote">Keep</Text>
                          </Button>
                        </Box>
                      ) : (
                        <Box columnGap={sp(v, 1)}>
                          <Button key={`undo-${f.id}`} plain onPress={() => setUi($, { undoAsk: f.id })}>
                            <Text color={t.accent} size="footnote">↶ Undo this turn</Text>
                          </Button>
                        </Box>
                      )
                    )}
                  </Box>
                )}
              </Box>
            )
          })}
          {!isOpen('flows') && flows.length > 3 && <Text color={t.faint} size="footnote">{`+ ${flows.length - 3} earlier`}</Text>}
        </Box>
      )}
      {(s.past.length > 0 || sessions.length > 0) && (
        <Box flexDirection="column">
          <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
            <Section k="past" label="Earlier sessions" n={s.past.length} />
            {spent > 0 && <Text color={t.faint} size="footnote">{`≈ $${spent.toFixed(2)} in 14 days`}</Text>}
          </Box>
          {isOpen('past') && sessions.length > 0 && (
            <Box flexDirection="column">
              <Text color={t.dim} size="footnote" wrap="wrap">{spent > 0 ? `Spend, last 14 days ≈ $${spent.toFixed(2)} (estimates)` : 'Nothing spent in the last 14 days'}</Text>
              {days.map(d => (
                <Box key={`spend-${d.day}`} columnGap={sp(v, 1)}>
                  <Text color={t.faint} size="footnote" mono>{d.day.slice(5)}</Text>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text color={d.usd ? t.accent : t.faint} size="footnote" mono wrap="truncate-end">{d.usd ? '█'.repeat(Math.max(1, Math.round((d.usd / peak) * 20))) : '·'}</Text>
                  </Box>
                  <Text color={t.dim} size="footnote" mono>{d.usd ? `$${d.usd.toFixed(2)}` : ''}</Text>
                </Box>
              ))}
              <Box columnGap={sp(v, 1)} flexWrap="wrap" alignItems="center">
                <Input key="budget-input" label="Daily budget ($)" placeholder="none" value={s.ui.budgetText ?? (s.dailyBudget ? String(s.dailyBudget) : '')} submitLabel="set" onInput={(val: string) => setUi($, { budgetText: val })} onSubmit={(val: string) => setBudget($, val)} />
                {s.dailyBudget ? (
                  <Text color={level === 'over' ? t.bad : level === 'near' ? t.busy : t.dim} size="footnote">{`$${todaySpend(sessions, v.now).toFixed(2)} of $${s.dailyBudget.toFixed(2)} today`}</Text>
                ) : null}
                {s.dailyBudget ? (
                  <Button key="budget-clear" plain onPress={() => set($, st => ({ dailyBudget: undefined, ui: { ...st.ui, budgetText: '' } }))}>
                    <Text color={t.dim} size="footnote">Clear</Text>
                  </Button>
                ) : null}
              </Box>
              <Text color={t.faint} size="footnote" wrap="wrap">It warns at 80% and 100%, once each a day; nothing is ever stopped.</Text>
              <Text color={t.dim} size="footnote">Costliest sessions</Text>
              {costliest(sessions, 5).map(x => (
                <Box key={`dear-${x.id}`} columnGap={sp(v, 1)} justifyContent="space-between">
                  <Text color={t.text} size="footnote" wrap="truncate-end">{`${dayOf(x.startedAt).slice(5)} · ${fmt(x.endedAt - x.startedAt)} · ${plural(x.turns, 'turn')}`}</Text>
                  <Text color={t.accent} size="footnote" mono>{`$${x.usd.toFixed(2)}`}</Text>
                </Box>
              ))}
            </Box>
          )}
          {isOpen('past') && s.past.slice(-8).reverse().map(f => (
            <Box key={`pf-${f.id}`} columnGap={sp(v, 1)}>
              <Text color={f.status === 'done' ? t.ok : t.bad}>{f.status === 'done' ? '✓' : '✗'}</Text>
              <Text color={t.faint} size="footnote" mono>{fmt((f.endedAt ?? f.startedAt) - f.startedAt)}</Text>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={t.dim} wrap="truncate-end">{f.task}</Text>
              </Box>
              <Box flexShrink={0} columnGap={sp(v, 1)}>
                {(f.add || f.del) > 0 && <Text color={t.faint} size="footnote">{`+${f.add} −${f.del}`}</Text>}
                {f.commit !== '' && w >= 60 && <Text color={t.accent} size="footnote" mono>{f.commit}</Text>}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      <Box flexDirection="column">
        <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Box columnGap={sp(v, 1)}>
            <Section k="ctx" label="Context" />
            <Text color={ctxCol} size="footnote" bold>{`${s.ctx.pct}%`}</Text>
          </Box>
          {!s.ui.confirmClear && (
            <Box columnGap={sp(v, 1)}>
              <Button key="ctx-compact" plain onPress={() => inBackground($, 'compact', 'Compacting', () => compactNow($))}>
                <Text color={t.dim} size="footnote">Compact</Text>
              </Button>
              <Button key="ctx-clear" plain onPress={() => setUi($, { confirmClear: true })}>
                <Text color={t.dim} size="footnote">Clear</Text>
              </Button>
            </Box>
          )}
        </Box>
        <Segs ui={v.ui} w={Math.max(10, w)} track={t.track} parts={s.ctx.segs.map(([, n], i) => [n / win, shades[i] ?? t.faint])} />
        {ctxLevel(s.ctx.pct) === 'bad' && <Text color={t.bad} size="footnote">Auto-compact is about to run.</Text>}
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
              <Button key="ctx-clear-no" label="Cancel" plain onPress={() => setUi($, { confirmClear: false })} />
            </Box>
          </Box>
        )}
      </Box>
      <Box flexDirection="column">
        <Box justifyContent="space-between" flexWrap="wrap">
          <Section k="dec" label="Decisions" {...(decs.length ? { n: decs.length } : {})} />
          {!isOpen('dec') && <Text color={t.faint} size="footnote">{modeOf(s.mode).status}</Text>}
        </Box>
        {isOpen('dec') && <Seg v={v} id="mode" value={s.mode} items={MODES.map(m => [m.id, m.label] as [typeof m.id, string])} onPick={k => set($, { mode: k })} />}
        {isOpen('dec') && <Text color={t.dim} size="footnote" wrap="wrap">{s.mode === 'off' ? 'Judges off: every question and next step is yours, with no advice.' : `${s.mode === 'auto' ? 'The judges answer questions and next steps; anything hard to undo, a split, or a fourth in a row comes to you with their advice.' : 'Every question and next step is yours; the judges say what they recommend.'} Complexity 0–3 → 3 judges · 4–6 → 6 · 7–10 → 9 · two thirds to pass.`}</Text>}
        {(isOpen('dec') ? decs : decs.slice(0, 3)).map(d => {
          const tl = tally(d)
          const open = s.ui.openDec === d.id
          return (
            <Box key={`dec-${d.id}`} flexDirection="column">
              <Box justifyContent="space-between" columnGap={sp(v, 2)} alignItems="center">
                <Box flexGrow={1} flexShrink={1}>
                  <Button key={`decb-${d.id}`} plain onPress={() => setUi($, { openDec: open ? '' : d.id })}>
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
                  {/* Each option's share of the panel, the leader starred once it clears two thirds */}
                  {d.opts.map((o, i) => {
                    const c = tl.counts[i] ?? 0
                    const lead = i === tl.top && c > 0
                    return (
                      <Box key={`opt-${d.id}-${i}`} gap={sp(v, 1)} alignItems="center">
                        <Box flexGrow={1} flexShrink={1}>
                          <Text color={lead ? t.text : t.dim} wrap="truncate-end">{`${i + 1}. ${o}`}</Text>
                        </Box>
                        <Bar ui={v.ui} w={10} frac={tl.n ? c / tl.n : 0} fill={lead ? (tl.passes ? t.ok : t.accent) : t.faint} track={t.track} />
                        <Text color={lead ? t.text : t.dim}>{`${c}/${tl.n}${lead && tl.passes ? ' ★' : '  '}`}</Text>
                      </Box>
                    )
                  })}
                  {d.votes.length > 0 && <Text color={t.faint} size="footnote">{`${tl.revealed}/${tl.n} voted · ${thrOf(tl.n)} to pass`}</Text>}
                  {/* The panel, a row a seat: its vote, its name, the model it voted with, its pick and why */}
                  {d.votes.map((vote, i) => (
                    <Box key={`seat-${d.id}-${i}`} flexDirection="column">
                      <Box gap={sp(v, 1)}>
                        <Text color={vote < 0 ? t.faint : vote === tl.top ? t.ok : t.bad}>{vote === -2 ? '–' : vote < 0 ? '◌' : vote === tl.top ? '✓' : '×'}</Text>
                        <Text color={vote < 0 ? t.faint : t.text}>{(SEAT_NAMES[i % SEAT_NAMES.length] ?? '').padEnd(11)}</Text>
                        {d.models?.[i] && <Text backgroundColor={t.track} color={t.dim} size="footnote">{` ${d.models[i]} `}</Text>}
                        <Text color={t.dim} wrap="truncate-end">{vote >= 0 ? (d.opts[vote] ?? '') : vote === -2 ? 'abstained' : 'thinking…'}</Text>
                      </Box>
                      {vote >= 0 && d.reasons?.[i] && <Box paddingLeft={2}><Text color={t.faint} size="footnote" wrap="wrap">{d.reasons[i]}</Text></Box>}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )
        })}
        {!isOpen('dec') && decs.length > 3 && <Text color={t.faint} size="footnote">{`+ ${decs.length - 3} earlier`}</Text>}
      </Box>
        </Box>
      )}
    </Box>
  )
}
