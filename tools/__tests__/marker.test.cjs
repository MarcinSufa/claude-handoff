const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { handoffPaths } = require('../paths.cjs')
const { writeMarker, readMarker, consume } = require('../marker.cjs')

function paths() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-mk-')))
  return handoffPaths(root)
}
const m = (over = {}) => ({ schema: 'handoff/v1', createdAt: new Date().toISOString(), doc: 'x', nonce: 'n1', ...over })

test('write then read returns the marker', () => {
  const p = paths(); writeMarker(p, m())
  assert.equal(readMarker(p).nonce, 'n1')
})

test('consume is single-shot: second read is null', () => {
  const p = paths(); writeMarker(p, m())
  consume(p)
  assert.equal(readMarker(p), null)
  assert.ok(fs.existsSync(p.consumed))
})

test('a marker older than TTL is stale -> null', () => {
  const p = paths()
  writeMarker(p, m({ createdAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }))
  assert.equal(readMarker(p), null)
})

test('corrupt JSON -> null (never throws)', () => {
  const p = paths(); fs.mkdirSync(p.dir, { recursive: true }); fs.writeFileSync(p.pending, '{not json')
  assert.equal(readMarker(p), null)
})
