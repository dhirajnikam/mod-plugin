export type Palette = 'paper' | 'white' | 'black' | 'solarized' | 'nord'
// 'auto' follows Claude Code's own light or dark theme
export type ThemeId = 'auto' | Palette
export type Tab = 'overview' | 'files' | 'agents' | 'git' | 'rules'
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
  status: 'scoring' | 'voting' | 'decided' | 'split' | 'you' | 'advised'
  result: string
  // What the judges recommend where they only advise (Ask me mode, or a decision that is hard to undo)
  advice?: string
  // Each seat's one-line reason for its vote, in seat order ('' while it has not voted)
  reasons?: string[]
  // The model each seat voted with, in seat order
  models?: string[]
  // question: Claude's question tool; next: the app's next-step box at the end of a turn
  kind?: 'question' | 'next'
}

export type TestCase = { n: string; st: 'pass' | 'fail' | 'fixed' | 'run'; err?: string }
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
  // From the agent's answer: its CASE lines (the testers), and its REPORT and HANDOFF lines (the experts)
  cases: TestCase[]
  report: string
  // A tester's run: the id of the agent whose work it tests
  for?: string
  // The agent's own task list (TodoWrite, or TaskCreate and TaskUpdate), as its run keeps it: its progress
  plan?: PlanItem[]
  // Who started it: you (a press or a command), Claude, Cockpit (a tester, the autopilot), a pipeline, or another agent
  by?: 'you' | 'claude' | 'cockpit' | 'pipeline' | 'agent'
  // The agent that started it, when by is 'agent'
  parent?: string
  // The plugin that provides its type: 'engine' for the built-ins, 'cockpit' for the experts, else another plugin's
  provider?: string
  // Its own git worktree, when it ran in one: where, on which branch, from which commit, and what it changed there
  // claude: made by Claude Code's own isolation (path '' and `before` set while Cockpit has yet to find it)
  worktree?: { path: string; branch: string; base: string; claude?: boolean; before?: string[]; nothing?: boolean; snap?: string; files?: string[]; add?: number; del?: number; removed?: boolean; back?: boolean }
  // The model and effort Cockpit chose for it, with why: "sonnet · medium — small docs change"
  pick?: string
}

export type RuleFiles = { settingsPath: string; settings: string; mdPath: string; md: string }
// An MCP server Claude Code would start here: env and header names only, never their values
// target: what it runs with tokens masked (masked: some were); shadowed: a server of the same name in a nearer scope wins
export type McpRow = { key: string; name: string; scope: 'project' | 'local' | 'user'; kind: 'stdio' | 'http' | 'sse'; target: string; masked: boolean; secrets: string[]; state: 'on' | 'off' | 'approval' | 'shadowed' }
// What loads into every session before you type: each memory file (label: its path from the repository, or from ~),
// the skills Claude may load by itself, the largest three, the MCP servers on, and the estimated tokens of files and skills
export type StartupLoad = {
  files: { path: string; label?: string; via?: string; missing?: boolean; skipped?: string; outside?: boolean; lines: number; tokens: number; long: boolean }[]
  skills: { path: string; name: string; tokens: number }[]
  largest: { path: string; name: string; tokens: number }[]
  mcpOn: number
  total: number
}
// A skill's SKILL.md: its folder, what its frontmatter says, and why it cannot be changed, if so
export type SkillFile = { path: string; folder: string; name: string; description: string; auto: boolean; error: string }
// The project's .mcp.json (its path, the only one Cockpit writes, and why it cannot be changed, if so) and every server
// that applies here; no file's text is kept, since env values live in it
export type McpFiles = { path: string; error: string; rows: McpRow[] }

// The autopilot: Claude works on a goal cycle after cycle until the judges agree it is done, a limit is hit, or you stop it
export type Autopilot = {
  goal: string
  // Limits, 0 for none: dollars of cost, hours of wall time
  budget: number
  hours: number
  at: number
  // The session's cost when it started, so the budget counts this run's spend only
  costAt: number
  cycle: number
  status: 'running' | 'paused' | 'done' | 'stopped'
  // Why it paused, stopped or finished
  why: string
  // The milestone the last cycle named as next, and cycles in a row that changed nothing
  next: string
  stall: number
  // Milestones ticked and in all, read from .cockpit/roadmap.md after each cycle
  done: number
  total: number
  // Task: works on one goal until it is achieved. Product owner: picks each next goal from where the product and its
  // field are going, by the judges' vote, and has Task build it, round after round (absent: task)
  role?: 'task' | 'product'
  // When the current goal started: its cycles' memory and the judges' evidence count from here (absent: at)
  goalAt?: number
  // Product owner: the vision it leads toward, its round, and whether it is scouting the next goal or building one
  vision?: string
  round?: number
  phase?: 'scout' | 'build'
  // Goals the product owner has had built, oldest first, and goals set aside in a row (three pause it)
  shipped?: string[]
  asides?: number
  // Cycles in a row with no milestone ticked; past two the prompt asks for another approach, at four it pauses
  stuck?: number
  // What the judges said was missing at the last done-check, carried into the next cycle; and DONE claims in a row
  // that added nothing new to the roadmap
  gaps?: string
  claims?: number
}

// A chain of experts on one task; each gets the reports of the ones before it
// for: the agent whose work a Verify pipeline tests
export type Pipeline = { name: string; steps: string[]; index: number; agentId: string; reports: string[]; at: number; for?: string }

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
  // auto: commit by itself; ask: propose each commit for your Commit/Skip; manual: only the button
  commitMode: 'auto' | 'ask' | 'manual'
  autoWhen: 'tests' | 'step' | 'done'
  // The per-repository setup wizard has run
  setupDone: boolean
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

// A commit Cockpit proposes in ask mode, waiting for your Commit or Skip
export type Pending = { type: string; branch: string; msg: string; files: string[]; at: number }

// One prompt's work: its steps, time, changes, decisions and commit
export type Flow = {
  id: string
  // The turn's snapshots under refs/cockpit/turns/<id>/: taken before and after it, so it can be undone
  snap?: { before?: boolean; after?: boolean; undone?: boolean }
  task: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'aborted'
  reached: string[]
  ops: number
  add: number
  del: number
  decisions: number
  commit: string
  // A flow picked by hand (/cockpit flow, or the picker); else the words of the task choose
  kind?: string
  // Claude's own task list for this prompt (TodoWrite, or TaskCreate and TaskUpdate): the flow's steps while it has one
  plan?: PlanItem[]
  // Steps written for this prompt's task, each tagged with the kind of work that reaches it
  steps?: { name: string; kind: string }[]
  // Turns this flow ran: more than one when a /goal, a background task or another plugin carried it on
  turns?: number
  // The session's cost when it opened, so the chat's turn line says what this flow spent
  costAt?: number
  // Its last turn's duration as the engine measured it: the TurnDuration row that ends it carries the same figure
  ms?: number
}

export type PlanItem = { id: string; text: string; st: 'pending' | 'in_progress' | 'completed' }

// One commit of the graph: refs as `git log %D` names them (HEAD -> main, origin/main, tag: v1)
export type LogCommit = { sha: string; parents: string[]; refs: string[]; msg: string; when: string; author: string }

// `from` is a rename's old path: it is committed with the new one
export type Changed = { path: string; meta: string; add: number; del: number; from?: string }
export type Commit = { sha: string; msg: string; meta: string; auto: boolean }

// The whole state. When a field's meaning changes, bump the shape tag on the atom in hooks/core/core.ts so an older
// stored value reads as INITIAL; a new field is optional, so a session saved by an older version still loads
export type Ph = {
  theme: ThemeId
  // The terminal's background as last read (core.ts readTermBg), for Auto; absent: not known, Claude Code's theme keys
  termBg?: 'dark' | 'light'
  // Focus: hide tool cards and turn lines, shrink the band to one line
  focus?: boolean
  tab: Tab
  // auto: the judges decide (risky decisions they only advise on); ask: they advise, you decide; off: no judges
  mode: 'auto' | 'ask' | 'off'
  task: string
  // The completion condition set by /goal or Claude's ProposeGoal, while one stands
  goal?: { text: string; at: number }
  autopilot?: Autopilot
  // The Rules tab's files as last read, for the repository and the user: settings.json (hooks, permissions) and CLAUDE.md
  rules?: { repo: RuleFiles; user: RuleFiles; mcp?: McpFiles; skills?: { repo: SkillFile[]; user: SkillFile[] }; load?: StartupLoad }
  // Slow work a press started, running past the press: its kind and the words that say it ("Pushing")
  busy?: Record<string, string>
  // The main loop's last tool call that failed or was refused: the Overview shows it while its flow is current
  lastError?: { tool: string; text: string; at: number }
  turnStart: number
  isWorking: boolean
  activity: string
  // The names of the steps reached so far; drives Progress
  reached: string[]
  // Every prompt's work, oldest first; the last one is the current flow
  flows: Flow[]
  // Earlier sessions' flows and agent runs, read from the repository's .cockpit/history.json
  past: Flow[]
  // What earlier sessions spent, from history.json; and when this one started (session.usage), to record its own
  pastSessions?: SessionSpend[]
  // A daily budget in dollars (absent: none), and the last day and level it warned at, so each warns once a day
  dailyBudget?: number
  budgetWarned?: { day: string; level: 'near' | 'over'; budget?: number }
  sessionAt?: number
  pastAgents: Agent[]
  // Runs you cleared from the list (the engine still lists them, so a sync must not bring them back), and when: a team
  // row shows no run older than that
  cleared: string[]
  clearedAt: number
  // When you last sent a prompt of your own, and how many next steps the judges answered since: kept in state, so a
  // reload does not forget a late answer or reset the count
  personAt: number
  judgedRun: number
  // The codebase memory: each source file (from the repository root) and the files it imports; at: when it was built
  memory: {
    at: number
    files: Record<string, string[]>
    // The product's features as a model named them from what each file exports, and the file set they were named for
    features?: { name: string; what: string; files: string[] }[]
    sig?: string
    // A model is naming them now
    naming?: boolean
    // What each file shows of itself: the names it exports and its first comment, for the feature pages
    facts?: Record<string, { exports: string[]; note: string }>
  }
  ops: FileOp[]
  // Every path of the project, relative to the root: the Activity tree's skeleton
  project: string[]
  // The codebase guide Claude writes on request: its path, and when the file was last written (0 while it is not there)
  guide?: { path: string; at: number; exists?: boolean }
  decisions: Decision[]
  waiting: string
  // Run the Verify experts after each turn that changes files
  autoVerify: boolean
  // Run the positive and the negative tester on each agent's run that changed files
  testAgents: boolean
  // Choose each expert's model and effort from the task (hooks/pick.ts); off: the agent's own defaults
  chooseModel: boolean
  // Tell me when work is done: a notice for each finish while the pane is not watched (absent: on)
  notifyDone?: boolean
  agents: Agent[]
  pipeline: Pipeline | null
  // What Cockpit is starting right now, for its agent.spawn hook to name the record by
  starting: { name: string; type: string; task: string; pick?: string } | null
  // Agent types the form can start: built-ins, agents/*.md files found, and any seen starting
  agentTypes: string[]
  // The tabs an add-on said it draws; absent, Cockpit draws every tab
  tabsAvailable?: Tab[]
  // Agents made from a description in the pane, as cockpit:<name>; their definitions are kept in the store
  custom: { type: string; name: string; what: string }[]
  // A description being turned into an agent right now
  creating: string
  // Several repos under the session folder (empty otherwise): the chosen one, and whether the person picked it by hand
  repos: { dir: string; name: string; branch: string; changed: number }[]
  repoDir: string
  repoHand: boolean
  git: GitForm
  // log: the recent commits of every branch, remote and tag, in graph order; unpushed: the current branch's commits its upstream lacks
  // pr: the current branch's pull request as gh reports it; null when it has none, absent before gh was asked
  repo: { isRepo: boolean; current: string; ahead: number; behind: number; changed: Changed[]; branches: string[]; log: LogCommit[]; unpushed: string[]; pr?: PrStatus | null }
  staged: Record<string, boolean>
  pending: Pending | null
  // The commit a model wrote from the diff of the ticked files (sig names them and their counts); busy while it writes
  suggest?: { sig: string; type: string; subject: string; busy?: boolean }
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
    openFlow: string
    // Agents started from the Agents tab run in a git worktree of their own
    agentWorktree?: boolean
    // A worktree agent's Bring back or Remove waiting for its confirm: back:<id> or rm:<id>
    wtAsk?: string
    // The earlier flow whose Undo this turn is waiting for Undo? / Keep
    undoAsk?: string
    // What is typed into the daily budget field
    budgetText?: string
    guideText?: string
    // The commit opened in the graph, and what git show said of it
    openCommit: string
    commitInfo: string
    collapsed: Record<string, boolean>
    treeSel: string
    more: boolean
    spawnOpen: boolean
    spawnTask: string
    spawnType: string
    // Any agent type, as typed: kept apart from spawnType so typing a listed name does not empty the field
    spawnTypeText?: string
    describe: string
    // Agents ticked on the team list, and the task to run them with ('' is the current one)
    selected: Record<string, boolean>
    runTask: string
    // Clear was pressed and waits for its confirmation
    confirmClear: boolean
    // The feature opened in the Activity tab's memory
    openFeature: string
    // The run (an agent id) or team agent (type:<type>) being run again with your instructions, and those instructions
    rerunFor: string
    rerunText: string
    // The autopilot form: open, its role (task or product owner), and its goal, budget and hours as typed
    apOpen?: boolean
    apRole?: 'task' | 'product'
    apGoal?: string
    apBudget?: string
    apHours?: string
    // The Rules tab: which scope, the item being edited or about to be deleted, the open add form, and the fields typed
    ruleScope?: 'repo' | 'user'
    ruleEdit?: string
    ruleDel?: string
    ruleAdd?: string
    ruleA?: string
    ruleB?: string
    ruleC?: string
    acctOpen: boolean
    // The account whose Remove was pressed, waiting for its confirmation
    acctRemove?: string
    // The setup wizard's step, the token being typed, and the gh web login's note
    gitStep: number
    ghToken: string
    ghNote: string
  }
}

// What Cockpit gives another plugin hooking it: it reads the state and changes it through
// these, which Cockpit answers, as only the state's owner writes it. `act` runs one of Cockpit's actions by name
export type Cockpit = {
  set: (e: { patch: Partial<Ph> }) => Promise<boolean>
  act: (e: { name: string; args: unknown[] }) => Promise<unknown>
  tab: (e: { id: Tab }) => Promise<boolean>
}

declare module 'claude-code' {
  interface EngineInterface {
    cockpit: Cockpit
  }
  interface PluginState {
    cockpit: { s: Shaped<Ph> }
  }
}

// The current branch's pull request, from `gh pr view` and `gh pr checks`
export interface PrStatus {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  // approved, changes requested, review required, draft, or '' when the repository asks for no review
  review: 'approved' | 'changes' | 'required' | 'draft' | ''
  // unknown: gh's answer could not be read (cut off, gh failed), so the counts say nothing
  checks: { pass: number; fail: number; pending: number; skip: number; failing: { name: string; link: string }[]; unknown?: boolean }
}

// A session's spend as Claude Code reports it: its start and last saved time, its dollars (as /cost totals them), its
// context tokens at its last turn (no running token total is reported) and its turns
export type SessionSpend = { id: string; startedAt: number; endedAt: number; usd: number; tokens: number; turns: number }
