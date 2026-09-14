const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { TTL_MS } = require('./marker.cjs')

function normalizePath(value) {
  let p = path.resolve(String(value))
  if (process.platform === 'win32') p = p.toLowerCase()
  return p
}

function pendingDir(home) { return path.join(home, 'pending') }
function digestFor(targetCwd) { return crypto.createHash('sha1').update(normalizePath(targetCwd)).digest('hex') }

function writeEntry(home, entry) {
  const dir = pendingDir(home)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, digestFor(entry.targetCwd) + '.json')
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(entry, null, 2))
  fs.renameSync(tmp, file) // atomic, same dir
}

// Raw, unfiltered rows with their file path: the hook needs this shape to sweep stale/invalid entries.
function listEntries(home) {
  const dir = pendingDir(home)
  let files
  try { files = fs.readdirSync(dir) } catch { return [] }
  const out = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    let entry
    try { entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
    out.push({ entry, file: path.join(dir, f) })
  }
  return out
}

function readEntries(home, now) {
  const t = now == null ? Date.now() : now
  return listEntries(home)
    .map(({ entry }) => entry)
    .filter((entry) => {
      const created = Date.parse(entry && entry.createdAt)
      return Number.isFinite(created) && t - created <= TTL_MS
    })
}

function matchEntry(entries, cwd) {
  const target = normalizePath(cwd)
  return entries.find((e) => normalizePath(e.callerCwd) === target || normalizePath(e.targetCwd) === target) || null
}

function removeEntry(home, targetCwd) {
  try { fs.unlinkSync(path.join(pendingDir(home), digestFor(targetCwd) + '.json')) } catch { /* already gone */ }
}

module.exports = { writeEntry, readEntries, listEntries, normalizePath, matchEntry, removeEntry }
