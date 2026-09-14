// tools/__tests__/stop-context-guard.test.cjs
// The Stop hook that refuses to end a turn above the save threshold until a fresh compact snapshot
// exists. Subprocess + stdin JSON; fail-open everywhere (exit 0, empty stdout).
const { test } = require('node:test'); const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { autoHandoffPaths, handoffPaths } = require('../paths.cjs')
const { writeMarker } = require('../marker.cjs')
const { writeBaseline } = require('../usage-flag.cjs')
const HOOK = path.join(__dirname, '..', '..', 'hooks', 'stop-context-guard.cjs')

function repo() { const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-stop-'))); fs.mkdirSync(path.join(r, '.git')); return r }
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
function run(input, env = cleanEnv()) {
  return spawnSync('node', [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env })
}
function payload(root, transcriptPath, sessionId = 's1', over = {}) {
  return { hook_event_name: 'Stop', session_id: sessionId, cwd: root, transcript_path: transcriptPath, ...over }
}
function block(result) {
  assert.equal(result.status, 0, result.stderr)
  const out = JSON.parse(result.stdout)
  assert.equal(out.decision, 'block')
  return out.reason
}
function compactMarker(root, sessionId, extra = {}) {
  const p = autoHandoffPaths(root, sessionId)
  fs.mkdirSync(p.dir, { recursive: true }); fs.writeFileSync(p.doc, '# Handoff')
  writeMarker(p, { schema: 'handoff/v1', createdAt: new Date().toISOString(), doc: p.doc, nonce: 'n', title: 'stop', generation: 1, resumeMode: 'compact', sessionId, clearEpoch: 0, tokensAtSave: 155000, ...extra })
  return p
}

test('registered in hooks.json under Stop through CLAUDE_PLUGIN_ROOT', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8')).hooks
  const entry = JSON.stringify(hooks.Stop)
  assert.match(entry, /\$\{CLAUDE_PLUGIN_ROOT\}/)
  assert.match(entry, /stop-context-guard\.cjs/)
})

test('below the save threshold → silent', () => {
  const root = repo()
  const r = run(payload(root, transcript(root, [usageLine(140000, 's1')])))
  assert.equal(r.status, 0); assert.equal(r.stdout.trim(), '')
})

test('above the save threshold with no snapshot → block naming the tokens, handoff.cjs and spawn compact; capped at two per epoch', () => {
  const root = repo(); const file = transcript(root, [usageLine(155000, 's1')])
  const reason = block(run(payload(root, file)))
  assert.match(reason, /155000/)
  assert.match(reason, /handoff\.cjs/)
  assert.match(reason, /"spawn":\s*"compact"/)
  assert.doesNotMatch(reason, /\/clear/)
  block(run(payload(root, file)))
  const third = run(payload(root, file))
  assert.equal(third.status, 0); assert.equal(third.stdout.trim(), '')
  assert.ok(fs.existsSync(path.join(root, '.claude', 'handoff', '.stop-deny.s1.json')))
})

test('the cap restarts on a new clear epoch', () => {
  const root = repo(); const file = transcript(root, [usageLine(155000, 's1')])
  block(run(payload(root, file))); block(run(payload(root, file)))
  assert.equal(run(payload(root, file)).stdout.trim(), '')
  writeBaseline(handoffPaths(root), 's1', { transcriptPath: 'elsewhere', offset: 0 })
  block(run(payload(root, file)))
})

test('a fresh compact snapshot owned by this session and epoch releases the Stop', () => {
  const root = repo(); const file = transcript(root, [usageLine(155000, 's1')])
  compactMarker(root, 's1')
  assert.equal(run(payload(root, file)).stdout.trim(), '')
})

test('a snapshot of another session, another epoch or with resumeMode clear does not release the Stop', () => {
  const foreign = repo(); compactMarker(foreign, 's1', { sessionId: 'other' })
  block(run(payload(foreign, transcript(foreign, [usageLine(155000, 's1')]))))
  const epoch = repo(); compactMarker(epoch, 's1', { clearEpoch: 1 })
  block(run(payload(epoch, transcript(epoch, [usageLine(155000, 's1')]))))
  const clear = repo(); compactMarker(clear, 's1', { resumeMode: 'clear' })
  block(run(payload(clear, transcript(clear, [usageLine(155000, 's1')]))))
})

test('a snapshot stale by more than HANDOFF_STALE_TOKENS asks for a refresh; within the window it releases', () => {
  const stale = repo(); compactMarker(stale, 's1', { tokensAtSave: 100000 })
  const reason = block(run(payload(stale, transcript(stale, [usageLine(155000, 's1')]))))
  assert.match(reason, /refresh/i)
  assert.match(reason, /"spawn":\s*"compact"/)
  const fresh = repo(); compactMarker(fresh, 's1', { tokensAtSave: 130000 })
  assert.equal(run(payload(fresh, transcript(fresh, [usageLine(155000, 's1')]))).stdout.trim(), '')
  const widened = repo(); compactMarker(widened, 's1', { tokensAtSave: 100000 })
  assert.equal(run(payload(widened, transcript(widened, [usageLine(155000, 's1')])), cleanEnv({ HANDOFF_STALE_TOKENS: '60000' })).stdout.trim(), '')
})

test('usage before the clear baseline is ignored', () => {
  const root = repo(); const file = transcript(root, [usageLine(155000, 's1')])
  writeBaseline(handoffPaths(root), 's1', { transcriptPath: file, offset: fs.statSync(file).size })
  assert.equal(run(payload(root, file)).stdout.trim(), '')
  fs.appendFileSync(file, usageLine(156000, 's1') + '\n')
  block(run(payload(root, file)))
})

test('thresholds: HANDOFF_CONTEXT_SAVE_TOKENS overrides, disabled turns the guard off', () => {
  const root = repo(); const file = transcript(root, [usageLine(120000, 's1')])
  block(run(payload(root, file), cleanEnv({ HANDOFF_CONTEXT_SAVE_TOKENS: '100000' })))
  const off = repo()
  assert.equal(run(payload(off, transcript(off, [usageLine(120000, 's1')])), cleanEnv({ HANDOFF_CONTEXT_SAVE_TOKENS: 'disabled' })).stdout.trim(), '')
})

test('HANDOFF_AUTOCOMPACT_WINDOW below save/0.75 warns on stderr without disabling the guard', () => {
  const root = repo(); const file = transcript(root, [usageLine(155000, 's1')])
  const r = run(payload(root, file), cleanEnv({ HANDOFF_AUTOCOMPACT_WINDOW: '180000' }))
  assert.match(r.stderr, /headroom/i)
  assert.match(r.stderr, /0\.75/)
  block(r)
  const ok = run(payload(repo(), file), cleanEnv({ HANDOFF_AUTOCOMPACT_WINDOW: '200000' }))
  assert.equal(ok.stderr.trim(), '')
})

test('fail-open: stop_hook_active, other events, sidechain-only usage, missing transcript, malformed stdin', () => {
  const root = repo(); const file = transcript(root, [usageLine(155000, 's1')])
  assert.equal(run(payload(root, file, 's1', { stop_hook_active: true })).stdout.trim(), '')
  assert.equal(run(payload(root, file, 's1', { hook_event_name: 'SubagentStop' })).stdout.trim(), '')
  assert.equal(run(payload(root, file, 's1', { hook_event_name: 'PostToolUse' })).stdout.trim(), '')
  const side = repo()
  assert.equal(run(payload(side, transcript(side, [usageLine(155000, 's1', { isSidechain: true }), usageLine(155000, 'other')]))).stdout.trim(), '')
  const missing = run(payload(root, path.join(root, 'nope.jsonl')))
  assert.equal(missing.status, 0); assert.equal(missing.stdout.trim(), '')
  const none = run(payload(root, undefined))
  assert.equal(none.status, 0); assert.equal(none.stdout.trim(), '')
  const malformed = run('{not json')
  assert.equal(malformed.status, 0); assert.equal(malformed.stdout.trim(), '')
  const empty = run('')
  assert.equal(empty.status, 0); assert.equal(empty.stdout.trim(), '')
})

test('a missing session_id is capped like any other session, not blocked forever (unlike the PreCompact F1 bug)', () => {
  const root = repo(); const file = transcript(root, [usageLine(155000, undefined)])
  block(run(payload(root, file, undefined)))
  block(run(payload(root, file, undefined)))
  assert.equal(run(payload(root, file, undefined)).stdout.trim(), '')
})
