// tools/compact-marker.cjs: the auto-compact snapshot (.claude/handoff/auto/<sid>/) as the Stop guard,
// the PreCompact interlock and the SessionStart re-seed see it. Ownership = marker.sessionId; freshness =
// TTL (readMarker), the clear epoch and the token distance since the save (fusion amendment AM1).
const fs = require('node:fs')
const path = require('node:path')
const { autoHandoffPaths, sanitizeSessionId } = require('./paths.cjs')
const { readMarker } = require('./marker.cjs')

const DEFAULT_STALE_TOKENS = 40000

function resolveStaleTokens(env = process.env) {
  const n = Number(env.HANDOFF_STALE_TOKENS)
  return env.HANDOFF_STALE_TOKENS != null && env.HANDOFF_STALE_TOKENS !== '' && Number.isFinite(n) ? n : DEFAULT_STALE_TOKENS
}

function readOwnedCompactMarker(root, sessionId) {
  const paths = autoHandoffPaths(root, sessionId)
  const marker = readMarker(paths)
  if (!marker || marker.resumeMode !== 'compact' || marker.sessionId !== sessionId) return null
  if (!fs.existsSync(paths.doc)) return null
  return { marker, paths }
}

function snapshotState(root, { sessionId, clearEpoch = 0, tokensNow = 0, env = process.env } = {}) {
  const owned = readOwnedCompactMarker(root, sessionId)
  if (!owned || Number(owned.marker.clearEpoch) !== clearEpoch) return 'missing'
  return tokensNow - (Number(owned.marker.tokensAtSave) || 0) > resolveStaleTokens(env) ? 'stale' : 'fresh'
}

function handoffCli() {
  return path.join(process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..'), 'tools', 'handoff.cjs')
}

function saveInstruction({ sessionId, stale = false, manualFallback = false } = {}) {
  const parts = [
    `${stale ? 'Refresh the saved state' : 'Save the working state'} now: author the 9-field handoff JSON`,
    '(goal, specifics, state, nextStep, constraints, gotchas, openQuestions, keepOnFail, verify, plus title)',
    `and pipe it to node "${handoffCli()}" with "spawn": "compact". Compaction then resets the context and the`,
    `SessionStart hook re-seeds you from .claude/handoff/auto/${sanitizeSessionId(sessionId)}/HANDOFF.md; continue working afterwards.`,
  ]
  if (manualFallback) parts.push('Manual fallback: "spawn": "clear", then ask the user to type /clear.')
  return parts.join(' ')
}

module.exports = { readOwnedCompactMarker, snapshotState, resolveStaleTokens, saveInstruction, DEFAULT_STALE_TOKENS }
