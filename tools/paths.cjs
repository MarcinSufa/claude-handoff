const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Anchor on cwd ONLY (CLAUDE_PROJECT_DIR is empty in the Cursor extension env: spec §4.1).
function resolveProjectRoot(startDir) {
  const start = path.resolve(startDir || process.cwd())
  let dir = start
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return start // hit fs root → fall back to the start dir
    dir = parent
  }
}

function handoffPaths(root) {
  const r = root || resolveProjectRoot()
  const dir = path.join(r, '.claude', 'handoff')
  return {
    root: r,
    dir,
    doc: path.join(dir, 'HANDOFF.md'),
    pending: path.join(dir, 'handoff.pending.json'),
    consumed: path.join(dir, 'handoff.consumed.json'),
    gitignore: path.join(r, '.gitignore'),
  }
}

function registryHome() {
  return process.env.HANDOFF_HOME || path.join(os.homedir(), '.claude', 'handoff')
}

module.exports = { resolveProjectRoot, handoffPaths, registryHome }
