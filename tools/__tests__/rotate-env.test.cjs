const { test } = require('node:test')
const assert = require('node:assert/strict')
const fixture = require('./fixtures/env-denylist.json')
const { rotate } = require('../rotate.cjs')
const { childEnv } = require('../spawn-tab.cjs')

const SAMPLE_CWD = 'C:/work/p0-h'
const SAMPLE_RUN_DIR = 'C:/work/p0-h/.exovault/runs'
const SAMPLE_NONCE = '0049672fbb20aaaaaaaaaaaaaaaaaaaa'

// R-2: child env = parent env minus every key matching ^CLAUDE_CODE_, minus CLAUDECODE, minus
// ELECTRON_RUN_AS_NODE; every other parent key preserved byte-for-byte.
function assertVector(env, expectedStripped, expectedKept, out) {
  for (const key of expectedStripped) assert.equal(out[key], undefined, `${key} must be stripped`)
  for (const key of expectedKept) assert.equal(out[key], env[key], `${key} must survive byte-for-byte`)
  assert.equal(Object.keys(out).length, expectedKept.length, 'no extra keys leak through')
}

test('rotate.cjs env-denylist.json vectors, captured through the CLI spawn call', () => {
  for (const vector of fixture.vectors) {
    let capturedEnv = null
    rotate(
      { host: 'cli', cwd: SAMPLE_CWD, run_dir: SAMPLE_RUN_DIR, nonce: SAMPLE_NONCE, settings_path: null },
      {
        platform: 'win32', env: vector.env,
        existsSync: () => true,
        exec: (cmd, args, opts) => { capturedEnv = opts && opts.env; return '111' },
      },
    )
    assert.ok(capturedEnv, 'exec must be called with an env option')
    assertVector(vector.env, vector.expected_stripped, vector.expected_kept, capturedEnv)
  }
})

test('rotate.cjs strips all nine observed_nine keys plus CLAUDECODE in one env, keeps OTHER_CLAUDE_VAR', () => {
  const env = { PATH: '/usr/bin', OTHER_CLAUDE_VAR: 'keep-me', CLAUDECODE: '1', ELECTRON_RUN_AS_NODE: '1' }
  for (const key of fixture.observed_nine) env[key] = 'strip-me'
  let capturedEnv = null
  rotate(
    { host: 'cli', cwd: SAMPLE_CWD, run_dir: SAMPLE_RUN_DIR, nonce: SAMPLE_NONCE, settings_path: null },
    {
      platform: 'win32', env,
      existsSync: () => true,
      exec: (cmd, args, opts) => { capturedEnv = opts && opts.env; return '222' },
    },
  )
  for (const key of fixture.observed_nine) assert.equal(capturedEnv[key], undefined, `${key} must be stripped`)
  assert.equal(capturedEnv.CLAUDECODE, undefined)
  assert.equal(capturedEnv.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(capturedEnv.OTHER_CLAUDE_VAR, 'keep-me', 'anchored prefix: OTHER_CLAUDE_VAR is not ^CLAUDE_CODE_')
  assert.equal(capturedEnv.PATH, '/usr/bin')
})

// This is childEnv() in tools/spawn-tab.cjs. Regression guard: the S3-actuator patch applies the
// full C10 deny-list here (not just ELECTRON_RUN_AS_NODE); asserted through spawn-tab.cjs directly
// (not rotate.cjs) so a future localised regression in only one of the two call sites still shows.
test('spawn-tab.cjs childEnv applies the full C10 deny-list, not just ELECTRON_RUN_AS_NODE', () => {
  const env = { PATH: '/usr/bin', OTHER_CLAUDE_VAR: 'keep-me', CLAUDECODE: '1', ELECTRON_RUN_AS_NODE: '1' }
  for (const key of fixture.observed_nine) env[key] = 'strip-me'
  const out = childEnv(env)
  for (const key of fixture.observed_nine) assert.equal(out[key], undefined, `${key} must be stripped by childEnv()`)
  assert.equal(out.CLAUDECODE, undefined, 'CLAUDECODE must be stripped by childEnv()')
  assert.equal(out.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(out.OTHER_CLAUDE_VAR, 'keep-me')
  assert.equal(out.PATH, '/usr/bin')
})
