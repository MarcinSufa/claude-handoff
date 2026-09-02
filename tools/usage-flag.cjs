// tools/usage-flag.cjs: per-session single-shot debounce for the rate-limit auto-trigger.
// Stores the highest level already fired for the CURRENT session so the PostToolUse hook does not
// re-nudge on every tool call. A new session (different sessionId) starts fresh. Never throws.
const fs = require('node:fs')

// Returns the level already fired for THIS sessionId ('none' | 'auto' | 'urgent'); 'none' if the flag
// is missing, corrupt, or belongs to a different session.
function readWarnedLevel(p, sessionId) {
  let parsed
  try { parsed = JSON.parse(fs.readFileSync(p.lastWarned, 'utf8')) } catch { return 'none' }
  if (!parsed || parsed.sessionId !== sessionId) return 'none'
  return parsed.level === 'auto' || parsed.level === 'urgent' ? parsed.level : 'none'
}

function markWarned(p, sessionId, level) {
  try {
    fs.mkdirSync(p.dir, { recursive: true })
    const tmp = p.lastWarned + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ sessionId, level, at: new Date().toISOString() }))
    fs.renameSync(tmp, p.lastWarned) // atomic, same dir
  } catch { /* best-effort: a debounce-write failure must never break the tool call */ }
}

module.exports = { readWarnedLevel, markWarned }
