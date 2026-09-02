// tools/usage-threshold.cjs: pure logic for the PostToolUse rate-limit auto-trigger (spec §1 v2, Option A).
// No I/O. The hook composes parsePercent → resolveThresholds → evaluate.

const DEFAULT_AUTO = 90
const DEFAULT_URGENT = 95
const RANK = { none: 0, auto: 1, urgent: 2 }

// Defensively read input.rate_limits.five_hour.used_percentage.
// rate_limits is documented for statusline stdin (CC ≥2.1.x) and claimed for PostToolUse by prior art;
// where it is absent we return null so the hook no-ops instead of crashing.
function parsePercent(input) {
  const raw = input && input.rate_limits && input.rate_limits.five_hour
    ? input.rate_limits.five_hour.used_percentage
    : undefined
  if (raw === undefined || raw === null || raw === '') return null
  const v = Number(raw)
  return Number.isFinite(v) ? v : null
}

// Resolve a single threshold env value: "disabled" (any case) → null; numeric → number; else → fallback.
function resolveOne(val, fallback) {
  if (val == null || val === '') return fallback
  if (String(val).trim().toLowerCase() === 'disabled') return null
  const n = Number(val)
  return Number.isFinite(n) ? n : fallback
}

function resolveThresholds(env = process.env) {
  return {
    autoPct: resolveOne(env.HANDOFF_AUTO_SAVE_PERCENT, DEFAULT_AUTO),
    urgentPct: resolveOne(env.HANDOFF_URGENT_PERCENT, DEFAULT_URGENT),
  }
}

// Decide which level the current percent has crossed and whether to fire (single-shot per session+level).
// lastLevel = highest level already fired this session ('none' | 'auto' | 'urgent').
function evaluate(percent, { autoPct, urgentPct, lastLevel } = {}) {
  const last = lastLevel || 'none'
  if (percent == null) return { level: 'none', shouldFire: false, percent: null }
  let level = 'none'
  if (urgentPct != null && percent >= urgentPct) level = 'urgent'
  else if (autoPct != null && percent >= autoPct) level = 'auto'
  const shouldFire = level !== 'none' && RANK[level] > RANK[last]
  return { level, shouldFire, percent }
}

module.exports = { parsePercent, resolveThresholds, evaluate, DEFAULT_AUTO, DEFAULT_URGENT, RANK }
