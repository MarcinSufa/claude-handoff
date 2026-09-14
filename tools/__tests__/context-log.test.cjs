const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { handoffPaths } = require('../paths.cjs')
const { appendContextLog, contextLogFile, MAX_LOG_BYTES } = require('../context-log.cjs')

function paths() {
  return handoffPaths(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-ctxlog-'))))
}
function entry(over = {}) {
  return { sid: 's1', epoch: 0, offset: 100, tokens: 1000, cacheRead: 900, cacheCreation: 50, event: 'usage', ...over }
}
function lines(p) {
  return fs.readFileSync(contextLogFile(p), 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
}

test('appends one NDJSON line with the eight fields and a timestamp', () => {
  const p = paths()
  assert.equal(appendContextLog(p, entry()), true)
  assert.equal(path.basename(contextLogFile(p)), 'context-log.ndjson')
  const [first] = lines(p)
  assert.deepEqual(Object.keys(first).sort(), ['cacheCreation', 'cacheRead', 'epoch', 'event', 'offset', 'sid', 'tokens', 'ts'])
  assert.ok(Number.isFinite(Date.parse(first.ts)))
  assert.equal(first.tokens, 1000)
})

test('a repeated (sid, offset, event) is skipped; a new offset, another sid or another event is written', () => {
  const p = paths()
  assert.equal(appendContextLog(p, entry()), true)
  assert.equal(appendContextLog(p, entry()), false)
  assert.equal(appendContextLog(p, entry({ offset: 200, tokens: 1100 })), true)
  assert.equal(appendContextLog(p, entry({ offset: 200, sid: 's2' })), true)
  assert.equal(appendContextLog(p, entry({ offset: 200, event: 'fallback:native-compaction' })), true)
  assert.equal(lines(p).length, 4)
  assert.ok(fs.existsSync(path.join(p.dir, '.context-log-last.s1.json')))
})

test('a log above the size cap is left alone and the call reports false', () => {
  const p = paths()
  fs.mkdirSync(p.dir, { recursive: true })
  fs.writeFileSync(contextLogFile(p), 'x'.repeat(MAX_LOG_BYTES + 1))
  assert.equal(appendContextLog(p, entry()), false)
  assert.equal(fs.statSync(contextLogFile(p)).size, MAX_LOG_BYTES + 1)
})

test('an append that would push the log past the cap is refused even though the log is under the cap before it', () => {
  const p = paths()
  fs.mkdirSync(p.dir, { recursive: true })
  fs.writeFileSync(contextLogFile(p), Buffer.alloc(MAX_LOG_BYTES - 1, 'x'))
  assert.equal(appendContextLog(p, entry()), false)
  assert.equal(fs.statSync(contextLogFile(p)).size, MAX_LOG_BYTES - 1)
})

test('never throws: an unwritable directory reports false', () => {
  const p = handoffPaths(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-ctxlog-'))))
  fs.mkdirSync(path.dirname(p.dir), { recursive: true })
  fs.writeFileSync(p.dir, 'a file where the directory should be')
  assert.equal(appendContextLog(p, entry()), false)
})
