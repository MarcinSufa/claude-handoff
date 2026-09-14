#!/usr/bin/env node
// hooks/usage-monitor.cjs: PostToolUse auto-trigger. Two independent signals, each single-shot per
// session, level and clear epoch: the 5-hour rate limit (rate_limits.five_hour.used_percentage) and the
// context size (newest assistant usage line in transcript_path). A TRIPWIRE, not a capture: a
// PostToolUse hook cannot author the 9-field state, so it nudges the agent to. Every call also appends
// the context reading to the context log. Fail-open: never throw, never block the tool.
const fs = require('node:fs')
const path = require('node:path')
const { resolveProjectRoot, handoffPaths } = require(path.join(__dirname, '..', 'tools', 'paths.cjs'))
const { parsePercent, resolveThresholds, resolveContextThresholds, evaluate } = require(path.join(__dirname, '..', 'tools', 'usage-threshold.cjs'))
const { readWarnedLevel, markWarned } = require(path.join(__dirname, '..', 'tools', 'usage-flag.cjs'))
const { readContextState } = require(path.join(__dirname, '..', 'tools', 'context-state.cjs'))
const { appendContextLog } = require(path.join(__dirname, '..', 'tools', 'context-log.cjs'))
const { saveInstruction } = require(path.join(__dirname, '..', 'tools', 'compact-marker.cjs'))

function rateLimitMessage(level, percent) {
  const pct = `${percent}%`
  if (level === 'urgent') {
    return [
      `🚨 You are at ${pct} of your 5-hour rate limit and may run out mid-task.`,
      'Run the /handoff skill NOW to capture your working state into a fresh session before you are cut off,',
      'then tell the user to close this session. (Durable memory remains your backup safety net.)',
    ].join(' ')
  }
  return [
    `⚠️ You are at ${pct} of your 5-hour rate limit.`,
    'This is a good moment to run the /handoff skill: capture your working state so it can resume cleanly',
    'in a fresh session before you hit the limit. Finish the current step first if it is nearly done.',
  ].join(' ')
}

function contextMessage(level, tokens, thresholds, sessionId) {
  const save = saveInstruction({ sessionId, manualFallback: true })
  if (level === 'urgent') {
    return `🚨 URGENT: your context is at ${tokens} tokens (urgent threshold ${thresholds.urgentTokens}); auto-compaction is near. ${save} Do it NOW, before the next tool call.`
  }
  return `⚠️ Your context is at ${tokens} tokens (save threshold ${thresholds.saveTokens}). ${save} Finish the current step first if it is nearly done.`
}

function rateLimitSignal(input, p, sessionId, clearEpoch) {
  const percent = parsePercent(input)
  if (percent == null) return null
  const { autoPct, urgentPct } = resolveThresholds(process.env)
  const lastLevel = readWarnedLevel(p, sessionId, { signal: 'rateLimit', clearEpoch })
  const { level, shouldFire } = evaluate(percent, { autoPct, urgentPct, lastLevel })
  if (!shouldFire) return null
  markWarned(p, sessionId, level, { signal: 'rateLimit', clearEpoch })
  return rateLimitMessage(level, percent)
}

function contextSignal(p, sessionId, clearEpoch, usage) {
  if (!usage) return null
  const thresholds = resolveContextThresholds(process.env)
  const lastLevel = readWarnedLevel(p, sessionId, { signal: 'context', clearEpoch })
  const { level, shouldFire } = evaluate(usage.tokens, { autoPct: thresholds.saveTokens, urgentPct: thresholds.urgentTokens, lastLevel })
  if (!shouldFire) return null
  markWarned(p, sessionId, level, { signal: 'context', clearEpoch })
  return contextMessage(level, usage.tokens, thresholds, sessionId)
}

function main() {
  let input = {}
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return }
  if (!input || typeof input !== 'object') return
  const root = resolveProjectRoot(input.cwd || process.cwd())
  const p = handoffPaths(root)
  const sessionId = input.session_id || ''
  const { clearEpoch, usage } = readContextState(p, sessionId, input.transcript_path)
  if (usage) {
    appendContextLog(p, {
      sid: sessionId, epoch: clearEpoch, offset: usage.byteOffset, tokens: usage.tokens,
      cacheRead: usage.cacheRead, cacheCreation: usage.cacheCreation, event: 'usage',
    })
  }
  const messages = [
    rateLimitSignal(input, p, sessionId, clearEpoch),
    contextSignal(p, sessionId, clearEpoch, usage),
  ].filter(Boolean)
  if (messages.length === 0) return
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: messages.join('\n\n') },
  }))
}

try { main() } catch { /* fail-open: never break the tool call */ }
process.exitCode = 0
