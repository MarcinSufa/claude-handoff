// tools/__tests__/usage-flag.test.cjs
// Per-session single-shot debounce so the PostToolUse hook fires each level at most once per session.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { handoffPaths } = require('../paths.cjs')
const { readWarnedLevel, markWarned } = require('../usage-flag.cjs')

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
  fs.writeFileSync(p.lastWarned, '{not json')
  assert.equal(readWarnedLevel(p, 's1'), 'none')
})
