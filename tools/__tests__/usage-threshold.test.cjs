// tools/__tests__/usage-threshold.test.cjs
// Pure logic for the PostToolUse rate-limit auto-trigger (spec §1 v2 leg, Option A).
const { test } = require('node:test')
const assert = require('node:assert')
const { parsePercent, resolveThresholds, evaluate } = require('../usage-threshold.cjs')

// ── parsePercent: defensively read input.rate_limits.five_hour.used_percentage ──
test('parsePercent reads a numeric five_hour.used_percentage', () => {
  assert.equal(parsePercent({ rate_limits: { five_hour: { used_percentage: 92.5 } } }), 92.5)
})
test('parsePercent returns 0 for a genuine 0% (not null)', () => {
  assert.equal(parsePercent({ rate_limits: { five_hour: { used_percentage: 0 } } }), 0)
})
test('parsePercent coerces a numeric string', () => {
  assert.equal(parsePercent({ rate_limits: { five_hour: { used_percentage: '88' } } }), 88)
})
test('parsePercent returns null when rate_limits is absent (CC versions without it → no-op)', () => {
  assert.equal(parsePercent({ session_id: 'x', cwd: '/p' }), null)
  assert.equal(parsePercent({ rate_limits: {} }), null)
  assert.equal(parsePercent({ rate_limits: { five_hour: {} } }), null)
  assert.equal(parsePercent(null), null)
})
test('parsePercent returns null for non-finite garbage', () => {
  assert.equal(parsePercent({ rate_limits: { five_hour: { used_percentage: 'abc' } } }), null)
  assert.equal(parsePercent({ rate_limits: { five_hour: { used_percentage: null } } }), null)
})

// ── resolveThresholds: env defaults 90/95, "disabled" → null, invalid → default ──
test('resolveThresholds defaults to 90/95 when env is empty (enabled by default)', () => {
  assert.deepEqual(resolveThresholds({}), { autoPct: 90, urgentPct: 95 })
})
test('resolveThresholds honors numeric overrides', () => {
  assert.deepEqual(resolveThresholds({ HANDOFF_AUTO_SAVE_PERCENT: '85', HANDOFF_URGENT_PERCENT: '97' }), { autoPct: 85, urgentPct: 97 })
})
test('resolveThresholds treats "disabled" (any case) as null for that level', () => {
  assert.deepEqual(resolveThresholds({ HANDOFF_AUTO_SAVE_PERCENT: 'disabled' }), { autoPct: null, urgentPct: 95 })
  assert.deepEqual(resolveThresholds({ HANDOFF_URGENT_PERCENT: 'DISABLED' }), { autoPct: 90, urgentPct: null })
})
test('resolveThresholds falls back to default on invalid input', () => {
  assert.deepEqual(resolveThresholds({ HANDOFF_AUTO_SAVE_PERCENT: 'abc' }), { autoPct: 90, urgentPct: 95 })
})

// ── evaluate: which level crossed, single-shot vs already-fired ──
const T = { autoPct: 90, urgentPct: 95 }
test('evaluate: null percent → none, no fire', () => {
  const r = evaluate(null, { ...T, lastLevel: 'none' })
  assert.equal(r.level, 'none'); assert.equal(r.shouldFire, false)
})
test('evaluate: below auto threshold → none, no fire', () => {
  assert.equal(evaluate(80, { ...T, lastLevel: 'none' }).shouldFire, false)
})
test('evaluate: crosses auto from none → auto, fire', () => {
  const r = evaluate(92, { ...T, lastLevel: 'none' })
  assert.equal(r.level, 'auto'); assert.equal(r.shouldFire, true); assert.equal(r.percent, 92)
})
test('evaluate: auto already fired this session → auto, no re-fire (single-shot)', () => {
  assert.equal(evaluate(93, { ...T, lastLevel: 'auto' }).shouldFire, false)
})
test('evaluate: crosses urgent from none → urgent, fire', () => {
  const r = evaluate(96, { ...T, lastLevel: 'none' })
  assert.equal(r.level, 'urgent'); assert.equal(r.shouldFire, true)
})
test('evaluate: escalates auto → urgent (fires again at the higher level)', () => {
  assert.equal(evaluate(96, { ...T, lastLevel: 'auto' }).shouldFire, true)
})
test('evaluate: urgent already fired → no re-fire', () => {
  assert.equal(evaluate(99, { ...T, lastLevel: 'urgent' }).shouldFire, false)
})
test('evaluate: auto disabled but urgent crossed → urgent fires', () => {
  const r = evaluate(96, { autoPct: null, urgentPct: 95, lastLevel: 'none' })
  assert.equal(r.level, 'urgent'); assert.equal(r.shouldFire, true)
})
test('evaluate: urgent disabled, percent above urgent but >= auto → auto fires', () => {
  const r = evaluate(96, { autoPct: 90, urgentPct: null, lastLevel: 'none' })
  assert.equal(r.level, 'auto'); assert.equal(r.shouldFire, true)
})
test('evaluate: both disabled → none, no fire', () => {
  assert.equal(evaluate(99, { autoPct: null, urgentPct: null, lastLevel: 'none' }).shouldFire, false)
})
