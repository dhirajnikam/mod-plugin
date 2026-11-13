import type { $ } from './core/core'
import { applyAccount, ghLoginToken, ghLoginWeb, loadAccounts, removeAccount, useAccount } from './git/accounts'
import { buildMemory } from './memory/memory-io'
import { claim, openPane, release, setTheme } from './core/core'
import { clearFinished, createAgent, discoverAgentTypes, rerun, runExpert, runMany, spawnAgent, startPipeline, stopAgent, stopAll, testAgent } from './agents/agents'
import { clearNow, compactNow } from './core/session'
import { commit, confirmPending, gitInit, loadProject, pullNow, pushNow, refreshGit, refreshRepo, setGit, showCommit, skipPending, suggestCommit } from './git/git'
import { resumeAutopilot, startAutopilot, stopAutopilot } from './judges/autopilot'


export const ACTS = ["applyAccount", "buildMemory", "claim", "clearFinished", "clearNow", "commit", "compactNow", "confirmPending", "createAgent", "discoverAgentTypes", "ghLoginToken", "ghLoginWeb", "gitInit", "loadAccounts", "loadProject", "openPane", "pullNow", "pushNow", "refreshGit", "refreshRepo", "release", "removeAccount", "rerun", "resumeAutopilot", "runExpert", "runMany", "setGit", "setTheme", "showCommit", "skipPending", "spawnAgent", "startAutopilot", "startPipeline", "stopAgent", "stopAll", "stopAutopilot", "suggestCommit", "testAgent", "useAccount"] as const

export async function act($: $, name: string, args: unknown[]): Promise<unknown> {
  const [a, b, c, d] = args as [never, never, never, never]
  const known = name as (typeof ACTS)[number]
  switch (known) {
    case 'applyAccount':
      return applyAccount($)
    case 'buildMemory':
      return buildMemory($, a)
    case 'claim':
      return claim($, a, b)
    case 'clearFinished':
      return clearFinished($)
    case 'clearNow':
      return clearNow($)
    case 'commit':
      return commit($, a, b)
    case 'compactNow':
      return compactNow($)
    case 'confirmPending':
      return confirmPending($)
    case 'createAgent':
      return createAgent($, a)
    case 'discoverAgentTypes':
      return discoverAgentTypes($)
    case 'ghLoginToken':
      return ghLoginToken($, a)
    case 'ghLoginWeb':
      return ghLoginWeb($)
    case 'gitInit':
      return gitInit($)
    case 'loadAccounts':
      return loadAccounts($)
    case 'loadProject':
      return loadProject($)
    case 'openPane':
      return openPane($)
    case 'pullNow':
      return pullNow($)
    case 'pushNow':
      return pushNow($)
    case 'refreshGit':
      return refreshGit($)
    case 'refreshRepo':
      return refreshRepo($)
    case 'release':
      return release($, a)
    case 'removeAccount':
      return removeAccount($, a)
    case 'rerun':
      return rerun($, a, b)
    case 'resumeAutopilot':
      return resumeAutopilot($)
    case 'runExpert':
      return runExpert($, a, b, c)
    case 'runMany':
      return runMany($, a, b)
    case 'setGit':
      return setGit($, a)
    case 'setTheme':
      return setTheme($, a)
    case 'showCommit':
      return showCommit($, a)
    case 'skipPending':
      return skipPending($)
    case 'spawnAgent':
      return spawnAgent($, a, b)
    case 'startAutopilot':
      return startAutopilot($, a, b, c, d)
    case 'startPipeline':
      return startPipeline($, a, b)
    case 'stopAgent':
      return stopAgent($, a, b)
    case 'stopAll':
      return stopAll($)
    case 'stopAutopilot':
      return stopAutopilot($, a, b)
    case 'suggestCommit':
      return suggestCommit($)
    case 'testAgent':
      return testAgent($, a, b)
    case 'useAccount':
      return useAccount($, a)
    default:
      known satisfies never
  }
  return undefined
}
