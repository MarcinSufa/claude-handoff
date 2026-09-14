// tools/__tests__/usage-flag.test.cjs
// Per-session single-shot debounce so the PostToolUse hook fires each level at most once per session
// and per clear epoch, plus the per-session context baseline written on SessionStart(source=clear).
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { handoffPaths } = require('../paths.cjs')
const { readWarnedLevel, markWarned, flagFile, readBaseline, writeBaseline, baselineFile, sanitizeSessionId, claimDenial, denyFile } = require('../usage-flag.cjs')

function paths() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-flag-')))
  return handoffPaths(root)
}

test('no flag file → none', () => {
  assert.equal(readWarnedLevel(paths(), 's1'), 'none')
})
test('markWarned then read for the SAME session returns that level', () => {
  const p = paths()
  markWarned(p, 's1', 'auto')
  assert.equal(readWarnedLevel(p, 's1'), 'auto')
})
test('a DIFFERENT session starts fresh (none), ignoring a prior session flag', () => {
  const p = paths()
  markWarned(p, 's1', 'urgent')
  assert.equal(readWarnedLevel(p, 's2'), 'none')
})
test('escalation auto → urgent persists the higher level', () => {
  const p = paths()
  markWarned(p, 's1', 'auto')
  markWarned(p, 's1', 'urgent')
  assert.equal(readWarnedLevel(p, 's1'), 'urgent')
})
test('corrupt flag file → none (never throws)', () => {
  const p = paths()
  fs.mkdirSync(p.dir, { recursive: true })
  fs.writeFileSync(flagFile(p, 's1'), '{not json')
  assert.equal(readWarnedLevel(p, 's1'), 'none')
})

test('flag files are per session and named with a sanitized session id', () => {
  const p = paths()
  markWarned(p, 'one.A-1', 'auto')
  markWarned(p, 'two_B', 'auto')
  markWarned(p, 'unsafe/sess:id', 'auto')
  assert.ok(fs.existsSync(path.join(p.dir, '.last-warned.one.A-1.json')))
  assert.ok(fs.existsSync(path.join(p.dir, '.last-warned.two_B.json')))
  assert.equal(path.basename(flagFile(p, 'unsafe/sess:id')), '.last-warned.unsafe_sess_id.json')
  assert.equal(sanitizeSessionId(''), 'unknown')
  assert.equal(sanitizeSessionId(undefined), 'unknown')
  assert.equal(readWarnedLevel(p, 'one.A-1'), 'auto')
  assert.equal(readWarnedLevel(p, 'two_B'), 'auto')
})

test('signals keep independent levels in the same flag file', () => {
  const p = paths()
  markWarned(p, 's1', 'auto', { signal: 'rateLimit' })
  assert.equal(readWarnedLevel(p, 's1', { signal: 'context' }), 'none')
  markWarned(p, 's1', 'urgent', { signal: 'context' })
  assert.equal(readWarnedLevel(p, 's1', { signal: 'rateLimit' }), 'auto')
  assert.equal(readWarnedLevel(p, 's1', { signal: 'context' }), 'urgent')
  const raw = JSON.parse(fs.readFileSync(flagFile(p, 's1'), 'utf8'))
  assert.equal(raw.sessionId, 's1')
  assert.ok(raw.at)
})

test('a level fired in an OLDER clearEpoch does not suppress the current one', () => {
  const p = paths()
  markWarned(p, 's1', 'urgent', { signal: 'context', clearEpoch: 0 })
  assert.equal(readWarnedLevel(p, 's1', { signal: 'context', clearEpoch: 0 }), 'urgent')
  assert.equal(readWarnedLevel(p, 's1', { signal: 'context', clearEpoch: 1 }), 'none')
  markWarned(p, 's1', 'auto', { signal: 'context', clearEpoch: 1 })
  assert.equal(readWarnedLevel(p, 's1', { signal: 'context', clearEpoch: 1 }), 'auto')
  assert.equal(JSON.parse(fs.readFileSync(flagFile(p, 's1'), 'utf8')).clearEpoch, 1)
})

test('baseline: none until written; writeBaseline increments clearEpoch and records the offset', () => {
  const p = paths()
  assert.equal(readBaseline(p, 's1'), null)
  const first = writeBaseline(p, 's1', { transcriptPath: '/t/a.jsonl', offset: 123 })
  assert.deepEqual(first, { sessionId: 's1', clearEpoch: 1, transcriptPath: '/t/a.jsonl', offset: 123 })
  assert.deepEqual(readBaseline(p, 's1'), first)
  assert.equal(writeBaseline(p, 's1', { transcriptPath: '/t/a.jsonl', offset: 456 }).clearEpoch, 2)
  assert.equal(readBaseline(p, 's1').offset, 456)
  assert.equal(readBaseline(p, 's2'), null)
  assert.equal(path.basename(baselineFile(p, 's1')), '.context-baseline.s1.json')
})

// ── denial counter: cap N per session/kind/clear epoch; the count survives any time gap and resets
// only on a new epoch (or a different session); floorMs only enforces a minimum spacing between the
// individual denials that consume the cap, it never re-arms an exhausted cap ──
test('claimDenial grants the cap, then refuses, in a file named per kind and sanitized session id', () => {
  const p = paths()
  const opts = { kind: 'stop', clearEpoch: 0, cap: 2, floorMs: 45000, now: 1000 }
  assert.equal(claimDenial(p, 'unsafe/s', opts), true)
  assert.equal(claimDenial(p, 'unsafe/s', { ...opts, now: 46001 }), true)
  assert.equal(claimDenial(p, 'unsafe/s', { ...opts, now: 92002 }), false)
  assert.equal(path.basename(denyFile(p, 'unsafe/s', 'stop')), '.stop-deny.unsafe_s.json')
  assert.ok(fs.existsSync(denyFile(p, 'unsafe/s', 'stop')))
  assert.equal(JSON.parse(fs.readFileSync(denyFile(p, 'unsafe/s', 'stop'), 'utf8')).count, 2)
})
test('claimDenial counts per kind, per session and per clear epoch', () => {
  const p = paths()
  const opts = { kind: 'stop', clearEpoch: 0, cap: 1, floorMs: 45000, now: 1000 }
  assert.equal(claimDenial(p, 's1', opts), true)
  assert.equal(claimDenial(p, 's1', opts), false)
  assert.equal(claimDenial(p, 's1', { ...opts, kind: 'compact' }), true)
  assert.equal(claimDenial(p, 's2', opts), true)
  assert.equal(claimDenial(p, 's1', { ...opts, clearEpoch: 1 }), true)
  assert.equal(claimDenial(p, 's1', { ...opts, clearEpoch: 1 }), false)
})
test('claimDenial does NOT reset once the last denial is merely older than the floor: the cap persists within the same epoch', () => {
  const p = paths()
  const opts = { kind: 'stop', clearEpoch: 0, cap: 1, floorMs: 45000, now: 1000 }
  assert.equal(claimDenial(p, 's1', opts), true)
  assert.equal(claimDenial(p, 's1', { ...opts, now: 46001 }), false, 'cap already reached, a floor-sized gap must not re-arm it')
  assert.equal(claimDenial(p, 's1', { ...opts, now: 1000000 }), false, 'nor does a much larger gap')
  fs.writeFileSync(denyFile(p, 's1', 'stop'), '{not json')
  assert.equal(claimDenial(p, 's1', opts), true, 'a corrupt file counts as empty state')
})
test('claimDenial suppresses a denial attempted within floorMs of the last one, without consuming the cap', () => {
  const p = paths()
  const opts = { kind: 'stop', clearEpoch: 0, cap: 2, floorMs: 45000, now: 100000 }
  assert.equal(claimDenial(p, 'f2-floor', opts), true, 'first denial is emitted')
  assert.equal(claimDenial(p, 'f2-floor', { ...opts, now: 100001 }), false, 'second denial within 45s is suppressed, not counted')
  assert.equal(JSON.parse(fs.readFileSync(denyFile(p, 'f2-floor', 'stop'), 'utf8')).count, 1, 'the suppressed attempt left the count unchanged')
  assert.equal(claimDenial(p, 'f2-floor', { ...opts, now: 145001 }), true, 'once spaced by the floor, the second denial is emitted')
  assert.equal(JSON.parse(fs.readFileSync(denyFile(p, 'f2-floor', 'stop'), 'utf8')).count, 2)
})

test('corrupt baseline → null, and the next write restarts at epoch 1', () => {
  const p = paths()
  fs.mkdirSync(p.dir, { recursive: true })
  fs.writeFileSync(baselineFile(p, 's1'), '{not json')
  assert.equal(readBaseline(p, 's1'), null)
  assert.equal(writeBaseline(p, 's1', { transcriptPath: 'x', offset: 0 }).clearEpoch, 1)
})
