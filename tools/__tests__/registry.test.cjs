const { test } = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function registry() { return require('../registry.cjs') }

function home() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-reg-'))) }
function entry(over = {}) {
  return {
    schema: 'handoff-registry/v1',
    createdAt: new Date().toISOString(),
    targetCwd: path.join(home(), 'target'),
    callerCwd: path.join(home(), 'caller'),
    doc: '/target/.claude/handoff/HANDOFF.md',
    pending: '/target/.claude/handoff/handoff.pending.json',
    title: 'handoff', generation: 1, nonce: 'n1', mode: 'same-window', ...over,
  }
}

test('writeEntry atomically writes the normalized target hash path', () => {
  const { writeEntry, normalizePath } = registry()
  const h = home(); const e = entry({ targetCwd: path.join(h, 'target') })
  writeEntry(h, e)
  const digest = crypto.createHash('sha1').update(normalizePath(e.targetCwd)).digest('hex')
  const file = path.join(h, 'pending', digest + '.json')
  assert.ok(fs.existsSync(file))
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), e)
  assert.deepEqual(fs.readdirSync(path.join(h, 'pending')), [digest + '.json'])
})

test('readEntries returns fresh entries and excludes stale entries', () => {
  const { writeEntry, readEntries } = registry()
  const h = home()
  writeEntry(h, entry({ targetCwd: path.join(h, 'fresh'), nonce: 'fresh', createdAt: new Date(Date.now() - 1000).toISOString() }))
  writeEntry(h, entry({ targetCwd: path.join(h, 'stale'), nonce: 'stale', createdAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }))
  const entries = readEntries(h, Date.now())
  assert.deepEqual(entries.map((e) => e.nonce), ['fresh'])
})

test('normalizePath ignores trailing separators and uses case-insensitive equality on win32', () => {
  const { normalizePath } = registry()
  const h = home()
  assert.equal(normalizePath(h), normalizePath(h + path.sep + path.sep))
  if (process.platform === 'win32') assert.equal(normalizePath(h), normalizePath(h.toUpperCase()))
})

test('matchEntry finds entries by callerCwd or targetCwd', () => {
  const { matchEntry } = registry()
  const h = home(); const e = entry({ targetCwd: path.join(h, 'target'), callerCwd: path.join(h, 'caller') })
  assert.strictEqual(matchEntry([e], e.callerCwd), e)
  assert.strictEqual(matchEntry([e], e.targetCwd + path.sep), e)
})

test('removeEntry deletes the registry file for a target cwd', () => {
  const { writeEntry, removeEntry } = registry()
  const h = home(); const e = entry({ targetCwd: path.join(h, 'target') })
  writeEntry(h, e)
  removeEntry(h, e.targetCwd)
  assert.deepEqual(fs.readdirSync(path.join(h, 'pending')), [])
})
