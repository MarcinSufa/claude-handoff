const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// GIT_CEILING_DIRECTORIES, as git reads it: the walk never climbs INTO a listed directory. Lets a
// caller (or a test under a shared /tmp that holds a stray .git) stop the search the way git would.
function ceilingDirs(env) {
  const raw = (env || process.env).GIT_CEILING_DIRECTORIES
  if (!raw) return new Set()
  return new Set(raw.split(path.delimiter).filter((d) => d && path.isAbsolute(d)).map((d) => path.resolve(d)))
}

// Anchor on cwd ONLY (CLAUDE_PROJECT_DIR is empty in the Cursor extension env: spec §4.1).
function resolveProjectRoot(startDir) {
  const start = path.resolve(startDir || process.cwd())
  const ceilings = ceilingDirs()
  let dir = start
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir || ceilings.has(parent)) return start // hit fs root or a ceiling → fall back to the start dir
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
    lastWarned: path.join(dir, '.last-warned.json'), // per-session debounce for the auto-trigger
    gitignore: path.join(r, '.gitignore'),
  }
}

function registryHome() {
  return process.env.HANDOFF_HOME || path.join(os.homedir(), '.claude', 'handoff')
}

module.exports = { resolveProjectRoot, handoffPaths, registryHome }
