const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')

// Best-effort durable record: always append a local JSONL (zero deps, works offline).
// A future network write can hook in here; failures must NEVER block a handoff.
function record(entry) {
  try {
    const dir = path.join(os.homedir(), '.claude', 'handoffs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'index.jsonl'), JSON.stringify(entry) + '\n')
    return { ok: true, memoryId: null }
  } catch { return { ok: false, memoryId: null } }
}

module.exports = { record }
