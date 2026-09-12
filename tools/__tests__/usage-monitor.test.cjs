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
  for (const key of Object.keys(e)) if (key.startsWith('HANDOFF_')) delete e[key]
  return { ...e, ...over }
}
function usageLine(tokens, sessionId, extra = {}) {
  return JSON.stringify({
    type: 'assistant', sessionId, isSidechain: false,
    message: { role: 'assistant', usage: { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } },
    ...extra,
  })
}
function transcript(root, lines) {
  const file = path.join(root, 'transcript.jsonl')
  fs.writeFileSync(file, lines.map((l) => l + '\n').join(''))
  return file
}
function ctxPay(root, transcriptPath, sessionId = 's1', over = {}) {
  return { hook_event_name: 'PostToolUse', session_id: sessionId, cwd: root, tool_name: 'Read', transcript_path: transcriptPath, ...over }
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

// ── context signal: newest assistant usage in transcript_path ──
test('context below the save threshold → silent', () => {
  const root = repo()
  assert.equal(run(ctxPay(root, transcript(root, [usageLine(140000, 's1')]))).trim(), '')
})
test('context at 155k → save nudge naming spawn clear, /clear and the token count', () => {
  const root = repo()
  const out = JSON.parse(run(ctxPay(root, transcript(root, [usageLine(155000, 's1')]))))
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse')
  const text = out.hookSpecificOutput.additionalContext
  assert.match(text, /spawn.*clear/i)
  assert.match(text, /\/clear/)
  assert.match(text, /155/)
  assert.match(text, /handoff\.cjs/)
})
test('context nudge is single-shot per level, then escalates to urgent at 185k', () => {
  const root = repo()
  const file = transcript(root, [usageLine(155000, 's1')])
  assert.notEqual(run(ctxPay(root, file)).trim(), '')
  assert.equal(run(ctxPay(root, file)).trim(), '')
  fs.appendFileSync(file, usageLine(185000, 's1') + '\n')
  const urgent = JSON.parse(run(ctxPay(root, file)))
  assert.match(urgent.hookSpecificOutput.additionalContext, /urgent/i)
  assert.match(urgent.hookSpecificOutput.additionalContext, /185/)
  assert.equal(run(ctxPay(root, file)).trim(), '')
})
test('context levels can be disabled via env', () => {
  const root = repo()
  const env = cleanEnv({ HANDOFF_CONTEXT_SAVE_TOKENS: 'disabled' })
  assert.equal(run(ctxPay(root, transcript(root, [usageLine(155000, 's1')])), env).trim(), '')
})
test('sidechain lines and other sessions never count', () => {
  const root = repo()
  const file = transcript(root, [usageLine(200000, 's1', { isSidechain: true }), usageLine(200000, 'other')])
  assert.equal(run(ctxPay(root, file)).trim(), '')
})
test('missing transcript file → silent, exit 0', () => {
  const root = repo()
  assert.equal(run(ctxPay(root, path.join(root, 'nope.jsonl'))).trim(), '')
})
test('rate-limit and context signals are independent', () => {
  const root = repo()
  const file = transcript(root, [usageLine(10000, 's1')])
  const rate = JSON.parse(run(ctxPay(root, file, 's1', { rate_limits: { five_hour: { used_percentage: 92 } } })))
  assert.match(rate.hookSpecificOutput.additionalContext, /92/)
  assert.doesNotMatch(rate.hookSpecificOutput.additionalContext, /\/clear/)
  fs.appendFileSync(file, usageLine(155000, 's1') + '\n')
  const both = JSON.parse(run(ctxPay(root, file, 's1', { rate_limits: { five_hour: { used_percentage: 96 } } })))
  assert.match(both.hookSpecificOutput.additionalContext, /96/)
  assert.match(both.hookSpecificOutput.additionalContext, /155/)
})
test('two sessions in one repo keep separate flag files', () => {
  const root = repo()
  const file = transcript(root, [usageLine(155000, 'a'), usageLine(155000, 'b')])
  assert.notEqual(run(ctxPay(root, file, 'a')).trim(), '')
  assert.notEqual(run(ctxPay(root, file, 'b')).trim(), '')
  assert.ok(fs.existsSync(path.join(root, '.claude', 'handoff', '.last-warned.a.json')))
  assert.ok(fs.existsSync(path.join(root, '.claude', 'handoff', '.last-warned.b.json')))
})
test('usage at or before the clear baseline offset is ignored; usage after it re-arms', () => {
  const root = repo()
  const file = transcript(root, [usageLine(155000, 's1')])
  assert.notEqual(run(ctxPay(root, file)).trim(), '')
  const { writeBaseline } = require('../usage-flag.cjs')
  const { handoffPaths } = require('../paths.cjs')
  writeBaseline(handoffPaths(root), 's1', { transcriptPath: file, offset: fs.statSync(file).size })
  assert.equal(run(ctxPay(root, file)).trim(), '')
  fs.appendFileSync(file, usageLine(155000, 's1') + '\n')
  assert.notEqual(run(ctxPay(root, file)).trim(), '')
})
