import type { Ticket, Tickets } from '../../types'
import type { $ } from '../core/core'
import { set, setUi } from '../core/core'
import { cut, plural } from '../core/text'
import type { V } from '../ui/shared'
import { sp, Seg, Head, Check, More } from '../ui/shared'
import { EMPTY, SOURCES, ticketLabel, ticketTree, ticketTypes } from './tickets'
import { connect, forget, refresh, findProjects, setSource, pickProject, clearProject, openTicket, explain, workOn } from './tickets-io'

// Tickets: Jira or Notion, through their makers' own MCP servers. The project this repository is for, its open
// tickets, the ones being worked on (ticked), and for an opened ticket what it asks for and the features it touches.
// Cockpit only reads a tracker: nothing here changes a ticket
export function TicketsTab($: $, v: V) {
  const { Box, Button, Input, Text } = v.ui
  const { s, t } = v
  const tk = s.tickets ?? EMPTY
  const c = tk.conn[tk.source]
  const name = SOURCES.find(([id]) => id === tk.source)?.[1] ?? tk.source
  const p = tk.project?.source === tk.source ? tk.project : undefined
  const busy = s.busy?.tickets
  const moreOpen = !!s.ui.collapsed['tickets-more']
  const isWorking = (id: string) => tk.working.some(x => x.id === id)
  // One list: the tickets being worked on first (as the tracker has them now, when it listed them), then the rest
  const all: Ticket[] = [...tk.working.map(w => tk.items.find(x => x.id === w.id) ?? w), ...tk.items.filter(x => !isWorking(x.id))]
  // By kind (Epic, Story, Task, Sub-task) when the list holds more than one, then as their hierarchy
  const types = ticketTypes(all)
  const type = types.includes(s.ui.ticketType ?? '') ? (s.ui.ticketType ?? '') : ''
  const rows = type ? all.filter(x => x.type === type) : all
  const tree = ticketTree(rows)
  const state = tk.working.length
    ? `Working on ${ticketLabel(tk.working[0]!)}${tk.working.length > 1 ? ` and ${tk.working.length - 1} more` : ''}`
    : p ? `${p.name} · ${plural(tk.items.length, 'open ticket')}`
    : c?.server ? 'Pick the project this repository is for'
    : 'Connect Jira or Notion to see your tickets here'
  const link = (key: string, label: string, onPress: () => unknown, color = t.accent) => (
    <Button key={key} plain onPress={onPress}>
      <Text color={color} size="footnote">{label}</Text>
    </Button>
  )
  // A brief kept from before the work was written per feature names its features only
  const work = (b: Tickets['briefs'][string]) => b.work ?? b.features.map(f => ({ feature: f, what: '' }))
  const detail = (x: Ticket) => {
    const b = tk.briefs[x.id]
    return (
      <Box flexDirection="column" paddingLeft={2} marginBottom={v.desk ? 'sm' : 1}>
        {(x.type || x.status) && <Text color={t.dim} size="footnote" wrap="truncate-end">{[x.type, x.status, x.parent ? `under ${x.parent}${x.parentTitle ? ` · ${x.parentTitle}` : ''}` : ''].filter(Boolean).join(' · ')}</Text>}
        {x.url !== '' && <Text color={t.faint} size="footnote" wrap="truncate-end">{x.url}</Text>}
        <Text color={t.dim} wrap="wrap">{cut(x.text ?? '', 600) || (busy ? 'Reading…' : 'No description.')}</Text>
        {!b && !!busy && <Text color={t.busy} size="footnote">Writing the summary…</Text>}
        {b && <Text color={t.text} wrap="wrap">{b.explain}</Text>}
        {/* What has to change in each existing feature (a link to it in the Activity tab), then what is new */}
        {b && work(b).length > 0 && <Head v={v} label="Work on existing features" />}
        {b && work(b).map(w => (
          <Box key={`tk-work-on-${x.id}-${w.feature}`} flexDirection="column">
            {link(`tk-feat-${x.id}-${w.feature}`, w.feature, () => set($, st => ({ tab: 'files', ui: { ...st.ui, openFeature: w.feature } })))}
            {w.what !== '' && <Text color={t.dim} wrap="wrap">{w.what}</Text>}
          </Box>
        ))}
        {b && !!b.fresh?.length && <Head v={v} label="New" />}
        {b && (b.fresh ?? []).map((n, i) => <Text key={`tk-new-${x.id}-${i}`} color={t.text} wrap="wrap">{`+ ${n}`}</Text>)}
        {b && !work(b).length && !b.fresh?.length && <Text color={t.dim} size="footnote" wrap="wrap">No feature of the codebase memory fits it.</Text>}
        {link(`tk-explain-${x.id}`, b ? '↻ Write it again' : '✦ Summarise it and name the work', () => explain($, x.id))}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={v.desk ? 'md' : 1}>
      <Text color={t.text} bold wrap="wrap">{state}</Text>
      <Seg v={v} id="tk-src" value={tk.source} items={SOURCES} onPick={k => setSource($, k)} />
      {!c?.server && (
        <Box flexDirection="column">
          {!!c?.why && <Text color={t.busy} wrap="wrap">{c.why}</Text>}
          {link('tk-connect', busy ?? `Connect ${name}`, () => connect($, tk.source))}
        </Box>
      )}
      {!!c?.server && !p && (
        <Box flexDirection="column">
          <Head v={v} label="This repository's project" n={tk.projects.length} />
          {tk.source === 'notion' && (
            <Input key="tk-find" label="Find" placeholder="the database your tickets are in" value={s.ui.ticketFind ?? ''} submitLabel="search" onInput={val => setUi($, { ticketFind: val })} onSubmit={val => findProjects($, val)} />
          )}
          {tk.projects.map(x => (
            <Button key={`tk-proj-${x.id}`} plain onPress={() => pickProject($, x)}>
              <Text color={t.text} wrap="truncate-end">{tk.source === 'jira' ? `${x.id} · ${x.name}` : x.name}</Text>
            </Button>
          ))}
          {tk.projects.length === 0 && tk.source === 'jira' && link('tk-projects', busy ?? '↻ Read the projects', () => refresh($), t.dim)}
        </Box>
      )}
      {!!c?.server && !!p && (
        <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Box columnGap={sp(v, 1)} alignItems="center" flexShrink={1}>
            {/* Back to the projects, to pick another for this repository */}
            {link('tk-change', '‹ Projects', () => clearProject($))}
            <Head v={v} label="Project" note={p.name} />
          </Box>
          <Box columnGap={sp(v, 1)} alignItems="center" flexWrap="wrap">
            {tk.source === 'jira' && <Seg v={v} id="tk-whose" value={s.ui.ticketAll ? 'all' : 'mine'} items={[['mine', 'Mine'], ['all', 'All open']]} onPick={k => Promise.resolve(setUi($, { ticketAll: k === 'all' })).then(() => refresh($))} />}
            {link('tk-refresh', busy ?? '↻ Read again', () => refresh($), t.dim)}
          </Box>
        </Box>
      )}
      {!!tk.error && <Text color={t.bad} wrap="wrap">{tk.error}</Text>}
      {rows.length > 0 && (
        <Box flexDirection="column">
          <Head v={v} label="Tickets" n={rows.length} note="tick the ones you are working on" />
          {types.length > 1 && <Seg v={v} id="tk-type" value={type} items={[['', 'All'], ...types.map((k): [string, string] => [k, k])]} onPick={k => setUi($, { ticketType: k })} />}
          {tree.map((r, i) => 'head' in r ? (
            // A parent the list does not hold: a heading over its children
            <Text key={`tk-head-${i}`} color={t.dim} size="footnote" wrap="truncate-end">{`▾ ${r.head}`}</Text>
          ) : ((x: Ticket) => (
            <Box key={`tk-row-${x.id}`} flexDirection="column" paddingLeft={r.depth * 2}>
              <Box justifyContent="space-between" columnGap={sp(v, 1)}>
                <Box flexShrink={1} columnGap={sp(v, 1)}>
                  <Check v={v} id={`tk-work-${x.id}`} on={isWorking(x.id)} label={x.key} onPress={() => workOn($, x.id)} />
                  <Button key={`tk-open-${x.id}`} plain onPress={() => openTicket($, x.id)}>
                    <Text color={t.text} wrap="truncate-end">{x.title}</Text>
                  </Button>
                </Box>
                {/* A narrow pane keeps the row to the key and the title: the status is in the opened ticket */}
                {v.w >= 50 && <Text color={t.dim} size="footnote">{cut([x.type, x.status].filter(Boolean).join(' · '), 28)}</Text>}
              </Box>
              {s.ui.ticketOpen === x.id && detail(x)}
            </Box>
          ))(r.t))}
        </Box>
      )}
      {!!c?.server && !!p && rows.length === 0 && !tk.error && <Text color={t.faint}>{busy ? 'Reading…' : s.ui.ticketAll || tk.source === 'notion' ? 'No open tickets.' : 'No open tickets assigned to you.'}</Text>}
      <More v={v} id="fold-more-tickets" open={moreOpen} onPress={() => setUi($, ui => ({ collapsed: { ...ui.collapsed, 'tickets-more': !moreOpen } }))} />
      {moreOpen && (
        <Box flexDirection="column">
          <Head v={v} label="Connections" />
          {SOURCES.map(([id, label]) => {
            const x = tk.conn[id]
            return (
              <Box key={`tk-conn-${id}`} justifyContent="space-between" columnGap={sp(v, 1)}>
                <Box flexShrink={1}>
                  <Text color={x?.server ? t.text : t.dim} size="footnote" wrap="truncate-end">{`${label}: ${x?.server ? `${x.server}${x.siteUrl ? ` · ${x.siteUrl}` : ''}` : x?.why ? 'not connected' : 'not connected yet'}`}</Text>
                </Box>
                {!!x && link(`tk-forget-${id}`, 'Forget', () => forget($, id), t.dim)}
              </Box>
            )
          })}
          <Text color={t.faint} size="footnote" wrap="wrap">Through Atlassian's and Notion's own MCP servers, with your sign-in (/mcp). Cockpit only reads: it never changes a ticket. A server joins your sessions once you press Connect, and stays out again after Forget.</Text>
        </Box>
      )}
    </Box>
  )
}
