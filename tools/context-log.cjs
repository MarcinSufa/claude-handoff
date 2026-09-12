// tools/context-log.cjs: append-only NDJSON of the context size per turn, for the live acceptance trace.
// Log-only: nothing reads it back except humans and the gate. Never throws.
const fs = require('node:fs')
const path = require('node:path')
const { sanitizeSessionId } = require('./paths.cjs')

const MAX_LOG_BYTES = 5 * 1024 * 1024
const FIELDS = ['ts', 'sid', 'epoch', 'offset', 'tokens', 'cacheRead', 'cacheCreation', 'event']

function contextLogFile(p) {
  return path.join(p.dir, 'context-log.ndjson')
}

function lastFile(p, sid) {
  return path.join(p.dir, `.context-log-last.${sanitizeSessionId(sid)}.json`)
}

function sizeOf(file) {
  try { return fs.statSync(file).size } catch { return 0 }
}

function readLast(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function appendContextLog(p, entry) {
  try {
    const sid = entry.sid == null ? '' : String(entry.sid)
    const offset = Number(entry.offset) || 0
    const event = entry.event || 'usage'
    const last = readLast(lastFile(p, sid))
    if (last && last.sid === sid && last.offset === offset && last.event === event) return false
    const log = contextLogFile(p)
    if (sizeOf(log) > MAX_LOG_BYTES) return false
    const line = {}
    for (const key of FIELDS) line[key] = entry[key]
    line.ts = entry.ts || new Date().toISOString()
    line.sid = sid
    line.epoch = Number(entry.epoch) || 0
    line.offset = offset
    line.tokens = Number(entry.tokens) || 0
    line.cacheRead = Number(entry.cacheRead) || 0
    line.cacheCreation = Number(entry.cacheCreation) || 0
    line.event = event
    fs.mkdirSync(p.dir, { recursive: true })
    fs.appendFileSync(log, JSON.stringify(line) + '\n')
    const tmp = lastFile(p, sid) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ sid, offset, event }))
    fs.renameSync(tmp, lastFile(p, sid))
    return true
  } catch {
    return false
  }
}

module.exports = { appendContextLog, contextLogFile, MAX_LOG_BYTES }
