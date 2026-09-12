#!/usr/bin/env node
// hooks/precompact-guard.cjs: PreCompact hook. Compaction is lossy, so both auto and manual triggers
// are blocked (exit 2) with the save-then-/clear instruction on stderr, unless HANDOFF_ALLOW_COMPACT=1.
// Malformed input fails open (exit 0): never wedge a session over a guard.
const fs = require('node:fs')

const MESSAGE = [
  'Compaction blocked by the handoff plugin: it is lossy. Run the /handoff skill with spawn "clear"',
  'instead: author the 9-field working state, pipe it to tools/handoff.cjs with "spawn":"clear",',
  'then ask the user to type /clear; the SessionStart hook resumes from .claude/handoff/HANDOFF.md.',
  'Set HANDOFF_ALLOW_COMPACT=1 to allow compaction for one session.',
].join(' ')

function main() {
  let input
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')) } catch { return 0 }
  if (!input || typeof input !== 'object') return 0
  if (process.env.HANDOFF_ALLOW_COMPACT === '1') return 0
  if (input.trigger !== 'auto' && input.trigger !== 'manual') return 0
  process.stderr.write(MESSAGE)
  return 2
}

let code = 0
try { code = main() } catch { code = 0 }
process.exitCode = code
