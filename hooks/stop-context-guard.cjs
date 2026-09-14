#!/usr/bin/env node
// hooks/stop-context-guard.cjs: Stop hook. Above the save threshold with no fresh compact snapshot for
// this session and epoch, the turn may not end: {"decision":"block"} asks the agent to save (or refresh)
// the state with spawn "compact". Capped at two blocks per epoch so a session is never stranded;
// everything else fails open with an empty stdout.
const fs = require('node:fs')
const path = require('node:path')
const { resolveProjectRoot, handoffPaths } = require(path.join(__dirname, '..', 'tools', 'paths.cjs'))
const { resolveContextThresholds } = require(path.join(__dirname, '..', 'tools', 'usage-threshold.cjs'))
const { claimDenial } = require(path.join(__dirname, '..', 'tools', 'usage-flag.cjs'))
const { readContextState } = require(path.join(__dirname, '..', 'tools', 'context-state.cjs'))
const { snapshotState, saveInstruction } = require(path.join(__dirname, '..', 'tools', 'compact-marker.cjs'))

const DENY_CAP = 2

function headroomWarning(saveTokens, env) {
  if (env.HANDOFF_AUTOCOMPACT_WINDOW == null || env.HANDOFF_AUTOCOMPACT_WINDOW === '') return null
  const window = Number(env.HANDOFF_AUTOCOMPACT_WINDOW)
  if (!Number.isFinite(window) || window <= 0 || saveTokens <= 0.75 * window) return null
  return `handoff: save threshold ${saveTokens} leaves no headroom, it exceeds 0.75 x the auto-compact window ${window}; lower HANDOFF_CONTEXT_SAVE_TOKENS or raise autoCompactWindow.\n`
}

function main() {
  let input
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')) } catch { return }
  if (!input || typeof input !== 'object' || input.hook_event_name !== 'Stop' || input.stop_hook_active === true) return
  const { saveTokens } = resolveContextThresholds(process.env)
  if (saveTokens == null) return
  const warning = headroomWarning(saveTokens, process.env)
  if (warning) process.stderr.write(warning)
  const root = resolveProjectRoot(input.cwd || process.cwd())
  const p = handoffPaths(root)
  const sessionId = input.session_id || ''
  const { clearEpoch, usage } = readContextState(p, sessionId, input.transcript_path)
  if (!usage || usage.tokens < saveTokens) return
  const state = snapshotState(root, { sessionId, clearEpoch, tokensNow: usage.tokens })
  if (state === 'fresh') return
  if (!claimDenial(p, sessionId, { kind: 'stop', clearEpoch, cap: DENY_CAP })) return
  const stale = state === 'stale'
  const reason = [
    `Your context is at ${usage.tokens} tokens (save threshold ${saveTokens}) and`,
    stale ? 'the saved state is out of date.' : 'no state is saved for this session.',
    saveInstruction({ sessionId, stale }),
    'Do not end the turn before the state is saved.',
  ].join(' ')
  process.stdout.write(JSON.stringify({ decision: 'block', reason }))
}

try { main() } catch { /* fail-open: never wedge a Stop over a guard */ }
process.exitCode = 0
