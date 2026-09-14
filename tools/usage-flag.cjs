// tools/usage-flag.cjs: per-session state for the hooks.
// .last-warned.<sid>.json holds the highest level already fired per signal (rateLimit, context) for the
// current clear epoch; .context-baseline.<sid>.json is written on SessionStart(source=clear|compact) and
// tells the monitor which transcript bytes predate the reset; .<kind>-deny.<sid>.json counts the
// Stop/PreCompact refusals of the current epoch so a guard can never strand a session. Never throws.
const fs = require('node:fs')
const path = require('node:path')
const { sanitizeSessionId } = require('./paths.cjs')

function flagFile(p, sessionId) {
  return path.join(p.dir, `.last-warned.${sanitizeSessionId(sessionId)}.json`)
}

function baselineFile(p, sessionId) {
  return path.join(p.dir, `.context-baseline.${sanitizeSessionId(sessionId)}.json`)
}

function denyFile(p, sessionId, kind) {
  return path.join(p.dir, `.${kind}-deny.${sanitizeSessionId(sessionId)}.json`)
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeJsonAtomic(p, file, value) {
  fs.mkdirSync(p.dir, { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(value))
  fs.renameSync(tmp, file)
}

function readFlag(p, sessionId, clearEpoch) {
  const parsed = readJson(flagFile(p, sessionId))
  if (!parsed || parsed.sessionId !== sessionId || (parsed.clearEpoch || 0) !== clearEpoch) return null
  return parsed
}

function readWarnedLevel(p, sessionId, { signal = 'rateLimit', clearEpoch = 0 } = {}) {
  const parsed = readFlag(p, sessionId, clearEpoch)
  const level = parsed && parsed.levels && parsed.levels[signal]
  return level === 'auto' || level === 'urgent' ? level : 'none'
}

function markWarned(p, sessionId, level, { signal = 'rateLimit', clearEpoch = 0 } = {}) {
  try {
    const current = readFlag(p, sessionId, clearEpoch)
    const levels = { ...(current && current.levels), [signal]: level }
    writeJsonAtomic(p, flagFile(p, sessionId), { sessionId, clearEpoch, levels, at: new Date().toISOString() })
  } catch { /* best-effort: a debounce-write failure must never break the tool call */ }
}

function readBaseline(p, sessionId) {
  const parsed = readJson(baselineFile(p, sessionId))
  if (!parsed || parsed.sessionId !== sessionId || !Number.isInteger(parsed.clearEpoch)) return null
  return parsed
}

function writeBaseline(p, sessionId, { transcriptPath, offset }) {
  const previous = readBaseline(p, sessionId)
  const baseline = { sessionId, clearEpoch: (previous ? previous.clearEpoch : 0) + 1, transcriptPath, offset }
  try { writeJsonAtomic(p, baselineFile(p, sessionId), baseline) } catch { /* fail-open: a lost baseline only delays the next nudge */ }
  return baseline
}

// True when this refusal is still within the cap for (session, kind, epoch); the count restarts only on
// a new epoch or a different session, never merely because time passed. An optional floorMs enforces a
// minimum spacing between the individual denials that consume the cap: an attempt made sooner than that
// is suppressed (returns false) without consuming a slot, so a legitimately spaced attempt can still
// land; the Stop and PreCompact guards leave it unset because the epoch-scoped cap alone bounds them.
// Any write failure counts as "cap reached" so a broken state directory can never produce unbounded
// blocking.
function claimDenial(p, sessionId, { kind, clearEpoch = 0, cap = 2, floorMs = 0, now = Date.now() } = {}) {
  const file = denyFile(p, sessionId, kind)
  const parsed = readJson(file)
  const current = parsed && parsed.sessionId === sessionId && parsed.clearEpoch === clearEpoch &&
    Number.isInteger(parsed.count) && Number.isFinite(parsed.lastAt)
    ? parsed
    : { sessionId, clearEpoch, count: 0, lastAt: null }
  if (current.count >= cap) return false
  if (floorMs > 0 && current.lastAt != null && now - current.lastAt < floorMs) return false
  try {
    writeJsonAtomic(p, file, { sessionId, clearEpoch, count: current.count + 1, lastAt: now })
    return true
  } catch {
    return false
  }
}

module.exports = { sanitizeSessionId, flagFile, baselineFile, denyFile, readWarnedLevel, markWarned, readBaseline, writeBaseline, claimDenial }
