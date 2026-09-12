// tools/__tests__/precompact-guard.test.cjs
// The PreCompact interlock: compaction passes only with a fresh compact snapshot for this session
// (or HANDOFF_ALLOW_COMPACT=1); refusals are capped per epoch and fall back to native compaction.
const { test } = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { autoHandoffPaths, handoffPaths } = require('../paths.cjs')
const { writeMarker } = require('../marker.cjs')
const { writeBaseline } = require('../usage-flag.cjs')
const HOOK = path.join(__dirname, '..', '..', 'hooks', 'precompact-guard.cjs')

function repo() { const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-pc-'))); fs.mkdirSync(path.join(r, '.git')); return r }
function cleanEnv(over = {}) {
  const e = { ...process.env }
  for (const key of Object.keys(e)) if (key.startsWith('HANDOFF_')) delete e[key]
  return { ...e, ...over }
}
function usageLine(tokens, sessionId) {
  return JSON.stringify({ type: 'assistant', sessionId, isSidechain: false, message: { role: 'assistant', usage: { input_tokens: tokens } } })
}
function transcript(root, lines) {
  const file = path.join(root, 'transcript.jsonl')
  fs.writeFileSync(file, lines.map((l) => l + '\n').join(''))
  return file
}
function run(input, env = cleanEnv()) {
  return spawnSync('node', [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env })
}
function payload(root, transcriptPath, over = {}) {
  return { hook_event_name: 'PreCompact', trigger: 'auto', session_id: 's1', cwd: root, transcript_path: transcriptPath, ...over }
}
function compactMarker(root, sessionId, extra = {}) {
  const p = autoHandoffPaths(root, sessionId)
  fs.mkdirSync(p.dir, { recursive: true }); fs.writeFileSync(p.doc, '# Handoff')
  writeMarker(p, { schema: 'handoff/v1', createdAt: new Date().toISOString(), doc: p.doc, nonce: 'n', title: 'pc', generation: 1, resumeMode: 'compact', sessionId, clearEpoch: 0, tokensAtSave: 1000, ...extra })
  return p
}
function logEvents(root) {
  const file = path.join(root, '.claude', 'handoff', 'context-log.ndjson')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l).event) : []
}

test('registered in hooks.json under PreCompact through CLAUDE_PLUGIN_ROOT', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8')).hooks
  const entry = JSON.stringify(hooks.PreCompact)
  assert.match(entry, /\$\{CLAUDE_PLUGIN_ROOT\}/)
  assert.match(entry, /precompact-guard\.cjs/)
})

for (const trigger of ['auto', 'manual']) {
  test(`${trigger} compaction without a snapshot is blocked: exit 2, stderr asks to save via handoff.cjs spawn compact (with the /clear fallback)`, () => {
    const root = repo()
    const r = run(payload(root, transcript(root, [usageLine(1000, 's1')]), { trigger }))
    assert.equal(r.status, 2)
    assert.match(r.stderr, /save/i)
    assert.match(r.stderr, /handoff\.cjs/)
    assert.match(r.stderr, /"spawn":\s*"compact"/)
    assert.match(r.stderr, /\/clear/)
    assert.equal(r.stdout.trim(), '')
  })
  test(`${trigger} compaction with a fresh snapshot for this session passes`, () => {
    const root = repo(); compactMarker(root, 's1')
    assert.equal(run(payload(root, transcript(root, [usageLine(1000, 's1')]), { trigger })).status, 0)
  })
}

test('a snapshot owned by another session, another epoch or with resumeMode clear is blocked', () => {
  const foreign = repo(); compactMarker(foreign, 's1', { sessionId: 'other' })
  assert.equal(run(payload(foreign, transcript(foreign, [usageLine(1000, 's1')]))).status, 2)
  const epoch = repo(); compactMarker(epoch, 's1', { clearEpoch: 3 })
  assert.equal(run(payload(epoch, transcript(epoch, [usageLine(1000, 's1')]))).status, 2)
  const clear = repo(); compactMarker(clear, 's1', { resumeMode: 'clear' })
  assert.equal(run(payload(clear, transcript(clear, [usageLine(1000, 's1')]))).status, 2)
})

test('a snapshot from the current baseline epoch passes', () => {
  const root = repo()
  writeBaseline(handoffPaths(root), 's1', { transcriptPath: 'x', offset: 0 })
  compactMarker(root, 's1', { clearEpoch: 1 })
  assert.equal(run(payload(root, transcript(root, [usageLine(1000, 's1')]))).status, 0)
})

test('a snapshot stale by more than HANDOFF_STALE_TOKENS is blocked once with a refresh request; within the window it passes', () => {
  const stale = repo(); compactMarker(stale, 's1', { tokensAtSave: 100000 })
  const r = run(payload(stale, transcript(stale, [usageLine(150000, 's1')])))
  assert.equal(r.status, 2)
  assert.match(r.stderr, /refresh/i)
  const fresh = repo(); compactMarker(fresh, 's1', { tokensAtSave: 100000 })
  assert.equal(run(payload(fresh, transcript(fresh, [usageLine(130000, 's1')]))).status, 0)
})

test('refusals are capped at two per epoch; the third passes and logs fallback:native-compaction', () => {
  const root = repo(); const file = transcript(root, [usageLine(1000, 's1')])
  assert.equal(run(payload(root, file)).status, 2)
  assert.equal(run(payload(root, file)).status, 2)
  assert.equal(run(payload(root, file)).status, 0)
  assert.deepEqual(logEvents(root), ['fallback:native-compaction'])
  assert.ok(fs.existsSync(path.join(root, '.claude', 'handoff', '.compact-deny.s1.json')))
  writeBaseline(handoffPaths(root), 's1', { transcriptPath: 'elsewhere', offset: 0 })
  assert.equal(run(payload(root, file)).status, 2)
})

test('HANDOFF_ALLOW_COMPACT=1 lets compaction through', () => {
  const root = repo()
  assert.equal(run(payload(root, transcript(root, [usageLine(1000, 's1')])), cleanEnv({ HANDOFF_ALLOW_COMPACT: '1' })).status, 0)
})

test('without a session id the refusal is not counted, so it still blocks and writes no state', () => {
  const r = run({ hook_event_name: 'PreCompact', trigger: 'auto' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /\/clear/)
  assert.equal(run({ hook_event_name: 'PreCompact', trigger: 'auto' }).status, 2)
  assert.equal(run({ hook_event_name: 'PreCompact', trigger: 'auto' }).status, 2)
})

test('malformed, empty or unknown-trigger stdin fails open with exit 0', () => {
  assert.equal(run('{not json').status, 0)
  assert.equal(run('').status, 0)
  assert.equal(run({ hook_event_name: 'PreCompact', trigger: 'other' }).status, 0)
})
