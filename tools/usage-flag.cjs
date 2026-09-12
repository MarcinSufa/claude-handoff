// tools/usage-flag.cjs: per-session state for the PostToolUse auto-trigger.
// .last-warned.<sid>.json holds the highest level already fired per signal (rateLimit, context) for the
// current clear epoch; .context-baseline.<sid>.json is written on SessionStart(source=clear) and tells
// the monitor which transcript bytes predate the clear. Never throws.
const fs = require('node:fs')
const path = require('node:path')

function sanitizeSessionId(sessionId) {
  const safe = String(sessionId == null ? '' : sessionId).replace(/[^A-Za-z0-9._-]/g, '_')
  return safe || 'unknown'
}

function flagFile(p, sessionId) {
  return path.join(p.dir, `.last-warned.${sanitizeSessionId(sessionId)}.json`)
}

function baselineFile(p, sessionId) {
  return path.join(p.dir, `.context-baseline.${sanitizeSessionId(sessionId)}.json`)
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

module.exports = { sanitizeSessionId, flagFile, baselineFile, readWarnedLevel, markWarned, readBaseline, writeBaseline }
