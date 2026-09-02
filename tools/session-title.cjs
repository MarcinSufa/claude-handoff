#!/usr/bin/env node
// Names the current Cursor/VS Code session tab: `node session-title.cjs "<title>"` (uses CLAUDE_CODE_SESSION_ID).
// Writes the custom-title sidecar the extension reads next to the session transcript. Never touches the transcript.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function projectsRoot(opts) {
  return (opts && opts.projectsDir) || process.env.HANDOFF_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects')
}

function findTranscript(sessionId, root) {
  let dirs = []
  try { dirs = fs.readdirSync(root) } catch { return null }
  for (const d of dirs) {
    const f = path.join(root, d, sessionId + '.jsonl')
    if (fs.existsSync(f)) return f
  }
  return null
}

// opts.transcriptPath: the hook-provided path, needed at SessionStart when the transcript file does not exist yet.
function writeTitle(sessionId, rawTitle, opts) {
  const title = sanitizeTitle(rawTitle)
  if (!sessionId || !title) return { ok: false, reason: 'missing-session-or-title' }
  const transcript = (opts && opts.transcriptPath) || findTranscript(sessionId, projectsRoot(opts))
  if (!transcript) return { ok: false, reason: 'no-transcript-for-session' }
  const dir = path.join(path.dirname(transcript), sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'custom-title.json')
  fs.writeFileSync(file, JSON.stringify({ customTitle: title }))
  return { ok: true, file }
}

function sessionNamePrefix(projectRoot) {
  const folder = String(projectRoot).split(/[\\/]/).filter(Boolean).pop() || ''
  return folder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-'
}

function composeTitle(title, generation) { return `${title} #${generation}` }

function sanitizeTitle(title) {
  const clean = String(title == null ? '' : title)
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9 ._#-]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
  return clean || null
}

if (require.main === module) {
  const title = process.argv.slice(2).join(' ').trim()
  const r = writeTitle(process.env.CLAUDE_CODE_SESSION_ID, title)
  process.stdout.write(JSON.stringify({ ...r, title }))
  process.exitCode = 0
}

module.exports = { writeTitle, sessionNamePrefix, composeTitle, sanitizeTitle, findTranscript }
