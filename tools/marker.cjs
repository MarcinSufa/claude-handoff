const fs = require('node:fs')

const TTL_MS = Number(process.env.HANDOFF_TTL_MS) || 86400000 // 24h (spec §4.4)

function writeMarker(p, marker) {
  fs.mkdirSync(p.dir, { recursive: true })
  const tmp = p.pending + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(marker, null, 2))
  fs.renameSync(tmp, p.pending) // atomic, same dir
}

function readMarker(p, now) {
  let raw
  try { raw = fs.readFileSync(p.pending, 'utf8') } catch { return null }
  let m
  try { m = JSON.parse(raw) } catch { return null }
  const created = Date.parse(m && m.createdAt)
  if (!Number.isFinite(created)) return null
  if ((now || Date.now()) - created > TTL_MS) return null // stale
  return m
}

function consume(p) {
  try { fs.renameSync(p.pending, p.consumed) } catch { /* already gone */ }
}

module.exports = { writeMarker, readMarker, consume, TTL_MS }
