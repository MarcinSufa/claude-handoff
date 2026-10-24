#!/usr/bin/env node
// hooks/usage-monitor.cjs: PostToolUse rate-limit auto-trigger (spec §1 v2 leg, Option A).
//
// A deterministic TRIPWIRE, not a capture: a PostToolUse hook can inject additionalContext but cannot
// author the 9-field state (that needs the agent): so when the 5-hour usage crosses a threshold this
// nudges the agent to checkpoint with /handoff (spawn "none") and resume after the limit resets. Enabled by default (90% / 95%); set HANDOFF_AUTO_SAVE_PERCENT or
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

// A fresh session draws on the same 5-hour quota, so the nudge asks for a CHECKPOINT (handoff with
// spawn "none": doc + pending marker, no new session), resumed by the next session in this project.
function message(level, percent) {
  const pct = `${percent}%`
  if (level === 'urgent') {
    return [
      `🚨 You are at ${pct} of your 5-hour rate limit and may be cut off mid-task.`,
      'A fresh session draws on the same limit, so do not open one now: save a checkpoint instead.',
      'Run the /handoff skill with spawn "none" (it writes HANDOFF.md and a pending marker in this project),',
      'then tell the user that the next session started in this project after the limit resets resumes it',
      '(the marker stays valid for 24 h). Durable memory remains your backup safety net.',
    ].join(' ')
  }
  return [
    `⚠️ You are at ${pct} of your 5-hour rate limit. A fresh session would draw on the same limit,`,
    'so a handoff now does not buy time. Once the current step is done, save a checkpoint: run the /handoff skill',
    'with spawn "none", so the work resumes in the next session started in this project after the limit resets.',
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
