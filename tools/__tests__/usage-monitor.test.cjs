// tools/__tests__/usage-monitor.test.cjs
// The PostToolUse rate-limit auto-trigger hook, driven as a subprocess with stdin JSON (like the
// SessionStart hook test). Fail-open: any error or absent data → empty output (tool call untouched).
const { test } = require('node:test'); const assert = require('node:assert')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const HOOK = path.join(__dirname, '..', '..', 'hooks', 'usage-monitor.cjs')

function repo() { const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-um-'))); fs.mkdirSync(path.join(r, '.git')); return r }

// Clean env so test results don't depend on the developer's own HANDOFF_* overrides.
function cleanEnv(over = {}) {
  const e = { ...process.env }
  delete e.HANDOFF_AUTO_SAVE_PERCENT; delete e.HANDOFF_URGENT_PERCENT
  return { ...e, ...over }
}
function run(payload, env = cleanEnv()) {
  return execFileSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env })
}
function pay(cwd, percent, over = {}) {
  const base = { hook_event_name: 'PostToolUse', session_id: 's1', cwd, tool_name: 'Read', ...over }
  if (percent != null) base.rate_limits = { five_hour: { used_percentage: percent } }
  return base
}

test('no rate_limits in payload → empty output (CC without rate_limits → no-op)', () => {
  assert.equal(run(pay(repo(), null)).trim(), '')
})
test('below threshold → empty output', () => {
  assert.equal(run(pay(repo(), 80)).trim(), '')
})
test('crossing the auto (90) threshold injects a handoff nudge naming the percent', () => {
  const out = JSON.parse(run(pay(repo(), 92)))
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse')
  assert.match(out.hookSpecificOutput.additionalContext, /handoff/i)
  assert.match(out.hookSpecificOutput.additionalContext, /92/)
})
test('single-shot: a second tool call at the same level stays silent', () => {
  const root = repo()
  assert.notEqual(run(pay(root, 91)).trim(), '') // first fires
  assert.equal(run(pay(root, 93)).trim(), '')    // second silent (same session, same level)
})
test('crossing urgent (95) injects an urgent nudge', () => {
  const out = JSON.parse(run(pay(repo(), 96)))
  assert.match(out.hookSpecificOutput.additionalContext, /handoff/i)
  assert.match(out.hookSpecificOutput.additionalContext, /96/)
})
test('escalation: after auto fires, crossing urgent fires again', () => {
  const root = repo()
  assert.notEqual(run(pay(root, 92)).trim(), '') // auto
  assert.notEqual(run(pay(root, 97)).trim(), '') // urgent escalates
})
test('disabled via env → silent even at 99%', () => {
  const env = cleanEnv({ HANDOFF_AUTO_SAVE_PERCENT: 'disabled', HANDOFF_URGENT_PERCENT: 'disabled' })
  assert.equal(run(pay(repo(), 99), env).trim(), '')
})
test('malformed stdin → empty output, fail-open (no throw)', () => {
  const out = execFileSync('node', [HOOK], { input: '{not json', encoding: 'utf8', env: cleanEnv() })
  assert.equal(out.trim(), '')
})
