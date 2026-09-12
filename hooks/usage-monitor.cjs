#!/usr/bin/env node
// hooks/usage-monitor.cjs: PostToolUse auto-trigger. Two independent signals, each single-shot per
// session, level and clear epoch: the 5-hour rate limit (rate_limits.five_hour.used_percentage) and the
// context size (newest assistant usage line in transcript_path). A TRIPWIRE, not a capture: a
// PostToolUse hook cannot author the 9-field state, so it nudges the agent to. Fail-open: never throw,
// never block the tool.
const fs = require('node:fs')
const path = require('node:path')
const { resolveProjectRoot, handoffPaths } = require(path.join(__dirname, '..', 'tools', 'paths.cjs'))
const { parsePercent, resolveThresholds, resolveContextThresholds, evaluate } = require(path.join(__dirname, '..', 'tools', 'usage-threshold.cjs'))
const { readWarnedLevel, markWarned, readBaseline } = require(path.join(__dirname, '..', 'tools', 'usage-flag.cjs'))
const { readNewestUsage } = require(path.join(__dirname, '..', 'tools', 'transcript-tail.cjs'))

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

function contextMessage(level, tokens, thresholds) {
  const save = [
    'Run the /handoff skill with spawn "clear": author the 9-field working state and pipe it to',
    'tools/handoff.cjs with "spawn":"clear", then ask the user to type /clear. The SessionStart hook',
    'resumes you from .claude/handoff/HANDOFF.md in this same session. Do NOT run /compact.',
  ].join(' ')
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

function contextSignal(input, p, sessionId, baseline) {
  if (!input.transcript_path) return null
  const clearEpoch = baseline ? baseline.clearEpoch : 0
  const minOffset = baseline && baseline.transcriptPath === input.transcript_path ? baseline.offset : 0
  const usage = readNewestUsage(input.transcript_path, { sessionId, minOffset })
  if (!usage) return null
  const thresholds = resolveContextThresholds(process.env)
  const lastLevel = readWarnedLevel(p, sessionId, { signal: 'context', clearEpoch })
  const { level, shouldFire } = evaluate(usage.tokens, { autoPct: thresholds.saveTokens, urgentPct: thresholds.urgentTokens, lastLevel })
  if (!shouldFire) return null
  markWarned(p, sessionId, level, { signal: 'context', clearEpoch })
  return contextMessage(level, usage.tokens, thresholds)
}

function main() {
  let input = {}
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return }
  if (!input || typeof input !== 'object') return
  const root = resolveProjectRoot(input.cwd || process.cwd())
  const p = handoffPaths(root)
  const sessionId = input.session_id || ''
  const baseline = readBaseline(p, sessionId)
  const messages = [
    rateLimitSignal(input, p, sessionId, baseline ? baseline.clearEpoch : 0),
    contextSignal(input, p, sessionId, baseline),
  ].filter(Boolean)
  if (messages.length === 0) return
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: messages.join('\n\n') },
  }))
}

try { main() } catch { /* fail-open: never break the tool call */ }
process.exitCode = 0
