export type Palette = 'paper' | 'white' | 'black' | 'solarized' | 'nord'
// 'auto' follows Claude Code's own light or dark theme
export type ThemeId = 'auto' | Palette
export type Tab = 'overview' | 'files' | 'tests' | 'agents' | 'git'
export type Line = { t: string; k: 'a' | 'd' | 'c' }

// One file operation seen in a tool call
export type FileOp = {
  id: string
  op: 'Search' | 'Read' | 'Write' | 'Edit' | 'Delete'
  path: string
  at: number
  meta: string
  add: number
  del: number
  lines: Line[]
}

// One question Claude asked: decided by judges or by the person
export type Decision = {
  id: string
  q: string
  opts: string[]
  at: number
  score: number
  signals: string[]
  // -1 while a seat has not voted; else the option index it chose
  votes: number[]
  status: 'scoring' | 'voting' | 'decided' | 'split' | 'you'
  result: string
}

export type TestCase = { n: string; st: 'pass' | 'fail' | 'fixed' | 'run'; err?: string }
export type Tester = {
  status: 'idle' | 'running' | 'done' | 'error'
  cases: TestCase[]
  agentId?: string
  startedAt?: number
  note?: string
}

export type Agent = {
  id: string
  name: string
  type: string
  task: string
  prompt: string
  status: 'running' | 'done' | 'stopped' | 'failed'
  startedAt: number
  endedAt?: number
  tools: number
  log: { at: number; t: string }[]
}

export type GitForm = {
  branch: string
  branchAuto: boolean
  branchPattern: string
  ticket: string
  user: string
  base: string
  type: string
  scope: string
  subject: string
  body: string
  msgPattern: string
  autoCommit: boolean
  autoWhen: 'tests' | 'step' | 'done'
  breaking: boolean
  push: boolean
  pr: boolean
  draft: boolean
  signoff: boolean
  gpg: boolean
  preTest: boolean
}

// A git identity to commit as, and the GitHub login to push and open PRs with
export type Account = { id: string; label: string; name: string; email: string; gh: string }

// `from` is a rename's old path: it is committed with the new one
export type Changed = { path: string; meta: string; add: number; del: number; from?: string }
export type Commit = { sha: string; msg: string; meta: string; auto: boolean }

export type Ph = {
  theme: ThemeId
  isDarkTerm: boolean
  // Focus: hide tool cards and turn lines, shrink the band to one line
  focus?: boolean
  tab: Tab
  mode: 'auto' | 'ask'
  task: string
  turnStart: number
  isWorking: boolean
  activity: string
  // Step index reached per step name; drives Progress
  reached: string[]
  ops: FileOp[]
  decisions: Decision[]
  waiting: string
  testers: { pos: Tester; neg: Tester }
  autoTest: boolean
  agents: Agent[]
  git: GitForm
  repo: { isRepo: boolean; current: string; ahead: number; changed: Changed[]; branches: string[] }
  staged: Record<string, boolean>
  commits: Commit[]
  accounts: Account[]
  accountId: string
  // How long the last main turn took, to tell its "Done in" line from older ones
  lastTurnMs: number
  ctx: { pct: number; used: number; window: number; segs: [string, number][] }
  cost: number
  ui: {
    openFile: string
    openDec: string
    openAgent: string
    fileView: 'tree' | 'list'
    collapsed: Record<string, boolean>
    treeSel: string
    more: boolean
    spawnOpen: boolean
    spawnTask: string
    spawnType: string
    testsHidden: boolean
    acctOpen: boolean
    acct: Account
  }
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: { s: Shaped<Ph> }
  }
}
