const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { autoHandoffPaths } = require('../paths.cjs')
const { writeMarker } = require('../marker.cjs')
const { readOwnedCompactMarker, snapshotState, resolveStaleTokens } = require('../compact-marker.cjs')

function repo() { const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-cm-'))); fs.mkdirSync(path.join(r, '.git')); return r }
function marker(root, sessionId, extra = {}) {
  const p = autoHandoffPaths(root, sessionId)
  fs.mkdirSync(p.dir, { recursive: true }); fs.writeFileSync(p.doc, '# Handoff')
  writeMarker(p, { schema: 'handoff/v1', createdAt: new Date().toISOString(), doc: p.doc, nonce: 'n', title: 'cm', generation: 1, resumeMode: 'compact', sessionId, clearEpoch: 0, tokensAtSave: 100000, ...extra })
  return p
}

test('readOwnedCompactMarker returns the marker and its paths only for a fresh compact marker owned by the session', () => {
  const root = repo(); const p = marker(root, 'sX')
  const owned = readOwnedCompactMarker(root, 'sX')
  assert.equal(owned.marker.sessionId, 'sX')
  assert.equal(owned.paths.pending, p.pending)
  assert.equal(readOwnedCompactMarker(root, 'sY'), null)
})
test('a marker with another owner, another resumeMode, a missing doc or an expired TTL is not owned', () => {
  const foreign = repo(); marker(foreign, 'sX', { sessionId: 'someone-else' })
  assert.equal(readOwnedCompactMarker(foreign, 'sX'), null)
  const clear = repo(); marker(clear, 'sX', { resumeMode: 'clear' })
  assert.equal(readOwnedCompactMarker(clear, 'sX'), null)
  const noDoc = repo(); const p = marker(noDoc, 'sX'); fs.unlinkSync(p.doc)
  assert.equal(readOwnedCompactMarker(noDoc, 'sX'), null)
  const old = repo(); marker(old, 'sX', { createdAt: new Date(Date.now() - 2 * 86400000).toISOString() })
  assert.equal(readOwnedCompactMarker(old, 'sX'), null)
})
test('snapshotState: missing without an owned marker or on an epoch mismatch, stale past HANDOFF_STALE_TOKENS, else fresh', () => {
  const root = repo(); marker(root, 'sX')
  assert.equal(snapshotState(root, { sessionId: 'sX', clearEpoch: 0, tokensNow: 130000, env: {} }), 'fresh')
  assert.equal(snapshotState(root, { sessionId: 'sX', clearEpoch: 0, tokensNow: 140000, env: {} }), 'fresh')
  assert.equal(snapshotState(root, { sessionId: 'sX', clearEpoch: 0, tokensNow: 140001, env: {} }), 'stale')
  assert.equal(snapshotState(root, { sessionId: 'sX', clearEpoch: 0, tokensNow: 140001, env: { HANDOFF_STALE_TOKENS: '50000' } }), 'fresh')
  assert.equal(snapshotState(root, { sessionId: 'sX', clearEpoch: 1, tokensNow: 100000, env: {} }), 'missing')
  assert.equal(snapshotState(root, { sessionId: 'sY', clearEpoch: 0, tokensNow: 100000, env: {} }), 'missing')
  assert.equal(snapshotState(repo(), { sessionId: 'sX', clearEpoch: 0, tokensNow: 0, env: {} }), 'missing')
})
test('resolveStaleTokens defaults to 40000 and ignores a non-numeric override', () => {
  assert.equal(resolveStaleTokens({}), 40000)
  assert.equal(resolveStaleTokens({ HANDOFF_STALE_TOKENS: '1000' }), 1000)
  assert.equal(resolveStaleTokens({ HANDOFF_STALE_TOKENS: 'lots' }), 40000)
})
