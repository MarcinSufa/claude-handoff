#!/usr/bin/env node
// hooks/usage-monitor.cjs: PostToolUse rate-limit auto-trigger (spec §1 v2 leg, Option A).
//
// A deterministic TRIPWIRE, not a capture: a PostToolUse hook can inject additionalContext but cannot
// author the 9-field state (that needs the agent): so when the 5-hour usage crosses a threshold this
// nudges the agent to run /handoff. Enabled by default (90% / 95%); set HANDOFF_AUTO_SAVE_PERCENT or
// HANDOFF_URGENT_PERCENT to a number to retune, or to "disabled" to turn a level off.
//
// Defensive: rate_limits.five_hour.used_percentage is documented for statusline stdin and claimed for
// PostToolUse by prior art: where it is absent we no-op. Fail-open: never throw, never block the tool.
// Single-shot per session+level via .last-warned.json so it does not re-nudge on every tool call.
const fs = require('node:fs')
const path = require('node:path')
const { resolveProjectRoot, handoffPaths } = require(path.join(__dirname, '..', 'tools', 'paths.cjs'))
const { parsePercent, resolveThresholds, evaluate } = require(path.join(__dirname, '..', 'tools', 'usage-threshold.cjs'))
const { readWarnedLevel, markWarned } = require(path.join(__dirname, '..', 'tools', 'usage-flag.cjs'))

function message(level, percent) {
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

function main() {
  let input = {}
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return } // fail-open
  const percent = parsePercent(input)
  if (percent == null) return // no usage data → no-op (older CC / non-subscriber)
  const root = resolveProjectRoot(input.cwd || process.cwd())
  const p = handoffPaths(root)
  const sessionId = input.session_id || ''
  const { autoPct, urgentPct } = resolveThresholds(process.env)
  const lastLevel = readWarnedLevel(p, sessionId)
  const { level, shouldFire } = evaluate(percent, { autoPct, urgentPct, lastLevel })
  if (!shouldFire) return
  markWarned(p, sessionId, level) // single-shot: do not re-nudge this level this session
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message(level, percent) },
  }))
}

try { main() } catch { /* fail-open: never break the tool call */ }
process.exitCode = 0
