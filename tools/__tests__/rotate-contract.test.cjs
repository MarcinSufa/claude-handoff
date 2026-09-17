const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { main } = require('../rotate.cjs')

const VALID_NONCE = '0049672fbb20aaaaaaaaaaaaaaaaaaaa'
const OK_DEPS = {
  platform: 'win32', env: { LOCALAPPDATA: 'C:/Users/test/AppData/Local' },
  existsSync: () => true,
  exec: () => '25196',
}

function run(stdinText, deps) {
  return main(stdinText, deps || OK_DEPS)
}

// R-8: malformed stdin => { ok: false, mode: null, pid: null, error: "bad_input" }, exit 1.
test('R-8 not JSON => bad_input, exit 1', () => {
  const r = run('not json at all')
  assert.deepEqual(r.output, { ok: false, mode: null, pid: null, error: 'bad_input' })
  assert.equal(r.exitCode, 1)
})

test('R-8 valid JSON but not an object (array, string, number, null) => bad_input, exit 1', () => {
  for (const text of ['[1,2,3]', '"a string"', '42', 'null']) {
    const r = run(text)
    assert.deepEqual(r.output, { ok: false, mode: null, pid: null, error: 'bad_input' })
    assert.equal(r.exitCode, 1)
  }
})

test('R-8 unknown host => bad_input, exit 1', () => {
  const r = run(JSON.stringify({ host: 'windows-terminal', cwd: '/c', run_dir: '/r', nonce: VALID_NONCE, settings_path: null }))
  assert.deepEqual(r.output, { ok: false, mode: null, pid: null, error: 'bad_input' })
  assert.equal(r.exitCode, 1)
})

test('R-8 missing or non-string cwd/run_dir => bad_input, exit 1', () => {
  const base = { host: 'cli', cwd: '/c', run_dir: '/r', nonce: VALID_NONCE, settings_path: null }
  const cases = [
    { ...base, cwd: 123 },
    { ...base, run_dir: null },
    (() => { const { cwd, ...rest } = base; return rest })(),
    (() => { const { run_dir, ...rest } = base; return rest })(),
  ]
  for (const input of cases) {
    const r = run(JSON.stringify(input))
    assert.deepEqual(r.output, { ok: false, mode: null, pid: null, error: 'bad_input' })
    assert.equal(r.exitCode, 1)
  }
})

test('R-8 settings_path neither string nor null => bad_input, exit 1', () => {
  const input = { host: 'cli', cwd: '/c', run_dir: '/r', nonce: VALID_NONCE, settings_path: 42 }
  const r = run(JSON.stringify(input))
  assert.deepEqual(r.output, { ok: false, mode: null, pid: null, error: 'bad_input' })
  assert.equal(r.exitCode, 1)
})

test('R-8 exit code is 0 only when ok is true, 1 otherwise', () => {
  const okInput = { host: 'cli', cwd: '/c', run_dir: '/r', nonce: VALID_NONCE, settings_path: null }
  const okResult = run(JSON.stringify(okInput))
  assert.equal(okResult.output.ok, true)
  assert.equal(okResult.exitCode, 0)

  const failResult = run(JSON.stringify(okInput), { ...OK_DEPS, exec: () => '' })
  assert.equal(failResult.output.ok, false)
  assert.equal(failResult.exitCode, 1)
})

test('R-8 main never throws on malformed input', () => {
  for (const text of [undefined, null, '', '{', '{"host":', Buffer.from([0xff, 0xfe]).toString()]) {
    assert.doesNotThrow(() => run(text))
  }
})

// Item 8 (review finding): the CLI entry point (`if (require.main === module)` in rotate.cjs) is
// never executed by any prior test, only `main()` called directly. Spawn a real child process.
// A bad_input stdin is used deliberately so no launcher ever actually runs.
test('R-8 CLI entry point: a real child process given bad_input on stdin prints exactly one JSON line and exits 1', () => {
  const rotatePath = path.join(__dirname, '..', 'rotate.cjs')
  let stdout; let status
  try {
    stdout = execFileSync(process.execPath, [rotatePath], { input: 'not json', encoding: 'utf8' })
    status = 0
  } catch (err) {
    stdout = err.stdout
    status = err.status
  }
  const lines = stdout.split('\n').filter((line) => line.length > 0)
  assert.equal(lines.length, 1, `stdout must carry exactly one line: ${JSON.stringify(stdout)}`)
  const parsed = JSON.parse(lines[0])
  assert.equal(parsed.ok, false)
  assert.equal(parsed.error, 'bad_input')
  assert.equal(status, 1)
})
