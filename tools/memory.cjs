const fs = require('node:fs'); const path = require('node:path')
const { registryHome } = require('./paths.cjs')

// Best-effort durable record: always append a local JSONL (zero deps, works offline).
// A future network write can hook in here; failures must NEVER block a handoff.
// Lives next to the registry (HANDOFF_HOME, default ~/.claude/handoff) so one knob isolates both.
function logPath() { return path.join(registryHome(), 'index.jsonl') }

function record(entry) {
  try {
    const dir = registryHome()
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(logPath(), JSON.stringify(entry) + '\n')
    return { ok: true, memoryId: null }
  } catch { return { ok: false, memoryId: null } }
}

module.exports = { record, logPath }
