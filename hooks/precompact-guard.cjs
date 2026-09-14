#!/usr/bin/env node
// hooks/precompact-guard.cjs: PreCompact interlock. Compaction is lossy, so auto and manual triggers pass
// (exit 0) only with a fresh compact snapshot for this session and epoch, or HANDOFF_ALLOW_COMPACT=1;
// otherwise exit 2 with the save instruction on stderr. Refusals are capped at two per epoch: the third
// logs fallback:native-compaction and passes, so a guard can never strand a session. Malformed input
// fails open (exit 0).
const fs = require('node:fs')
const path = require('node:path')
const { resolveProjectRoot, handoffPaths } = require(path.join(__dirname, '..', 'tools', 'paths.cjs'))
const { claimDenial } = require(path.join(__dirname, '..', 'tools', 'usage-flag.cjs'))
const { readContextState } = require(path.join(__dirname, '..', 'tools', 'context-state.cjs'))
const { appendContextLog } = require(path.join(__dirname, '..', 'tools', 'context-log.cjs'))
const { snapshotState, saveInstruction } = require(path.join(__dirname, '..', 'tools', 'compact-marker.cjs'))

const DENY_CAP = 2
const DENY_FLOOR_MS = 45000

function main() {
  let input
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')) } catch { return 0 }
  if (!input || typeof input !== 'object') return 0
  if (process.env.HANDOFF_ALLOW_COMPACT === '1') return 0
  if (input.trigger !== 'auto' && input.trigger !== 'manual') return 0
  const root = resolveProjectRoot(input.cwd || process.cwd())
  const p = handoffPaths(root)
  const sessionId = input.session_id || ''
  const { clearEpoch, usage } = readContextState(p, sessionId, input.transcript_path)
  const tokensNow = usage ? usage.tokens : 0
  if (!sessionId) {
    appendContextLog(p, {
      sid: sessionId, epoch: clearEpoch, offset: usage ? usage.byteOffset : 0, tokens: tokensNow,
      cacheRead: usage ? usage.cacheRead : 0, cacheCreation: usage ? usage.cacheCreation : 0, event: 'precompact:no-session',
    })
    return 0
  }
  const state = snapshotState(root, { sessionId, clearEpoch, tokensNow })
  if (state === 'fresh') return 0
  if (!claimDenial(p, sessionId, { kind: 'compact', clearEpoch, cap: DENY_CAP, floorMs: DENY_FLOOR_MS })) {
    appendContextLog(p, {
      sid: sessionId, epoch: clearEpoch, offset: usage ? usage.byteOffset : 0, tokens: tokensNow,
      cacheRead: usage ? usage.cacheRead : 0, cacheCreation: usage ? usage.cacheCreation : 0, event: 'fallback:native-compaction',
    })
    return 0
  }
  const stale = state === 'stale'
  process.stderr.write([
    'Compaction blocked by the handoff plugin:',
    stale ? 'the saved state is out of date' : 'no state is saved for this session',
    `and compaction is lossy. ${saveInstruction({ sessionId, stale, manualFallback: true })}`,
    'Set HANDOFF_ALLOW_COMPACT=1 to allow compaction for one session.',
  ].join(' '))
  return 2
}

let code = 0
try { code = main() } catch { code = 0 }
process.exitCode = code
