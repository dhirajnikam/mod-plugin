import type { Ph } from '../../types'

// The three decision modes: what a button to pick one says (label), what a status line says while it is on (status),
// and what it means, as /cockpit mode explains it (what)
export const MODES: { id: Ph['mode']; label: string; status: string; what: string }[] = [
  { id: 'auto', label: 'Auto', status: 'Auto · judges decide', what: 'the judges decide, and only advise on what is hard to undo' },
  { id: 'ask', label: 'Ask me', status: 'Ask me · judges advise', what: 'they advise, you decide' },
  { id: 'off', label: 'Off', status: 'Judges off', what: 'no judges' },
]
export const modeOf = (id: Ph['mode']) => MODES.find(m => m.id === id) ?? MODES[0]!
