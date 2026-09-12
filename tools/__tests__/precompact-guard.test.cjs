const { test } = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'); const path = require('node:path')
const HOOK = path.join(__dirname, '..', '..', 'hooks', 'precompact-guard.cjs')

function cleanEnv(over = {}) {
  const e = { ...process.env }
  delete e.HANDOFF_ALLOW_COMPACT
  return { ...e, ...over }
}
function run(input, env = cleanEnv()) {
  return spawnSync('node', [HOOK], { input, encoding: 'utf8', env })
}

test('registered in hooks.json under PreCompact through CLAUDE_PLUGIN_ROOT', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8')).hooks
  const entry = JSON.stringify(hooks.PreCompact)
  assert.match(entry, /\$\{CLAUDE_PLUGIN_ROOT\}/)
  assert.match(entry, /precompact-guard\.cjs/)
})

for (const trigger of ['auto', 'manual']) {
  test(`${trigger} compaction is blocked: exit 2, stderr tells the agent to save then /clear`, () => {
    const r = run(JSON.stringify({ hook_event_name: 'PreCompact', trigger }))
    assert.equal(r.status, 2)
    assert.match(r.stderr, /\/clear/)
    assert.match(r.stderr, /spawn.*clear/i)
    assert.equal(r.stdout.trim(), '')
  })
}

test('HANDOFF_ALLOW_COMPACT=1 lets compaction through', () => {
  assert.equal(run(JSON.stringify({ trigger: 'auto' }), cleanEnv({ HANDOFF_ALLOW_COMPACT: '1' })).status, 0)
})

test('malformed or empty stdin fails open with exit 0', () => {
  assert.equal(run('{not json').status, 0)
  assert.equal(run('').status, 0)
})
