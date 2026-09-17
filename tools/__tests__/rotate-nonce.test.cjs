const { test } = require('node:test')
const assert = require('node:assert/strict')
const fixture = require('./fixtures/nonce-vectors.json')
const { ROTATE_PROMPT_RE, buildPrompt, rotate, main } = require('../rotate.cjs')

const OK_DEPS = {
  platform: 'win32', env: { LOCALAPPDATA: 'C:/Users/test/AppData/Local' },
  existsSync: () => true,
  exec: () => '25196',
}

function nonceFromAcceptPrompt(prompt) {
  return prompt.slice('ctx-rotate:'.length)
}

test('ROTATE_PROMPT_RE is exactly /^ctx-rotate:[0-9a-f]{32}$/', () => {
  assert.equal(ROTATE_PROMPT_RE.source, '^ctx-rotate:[0-9a-f]{32}$')
})

test('buildPrompt(nonce) equals the accept row prompt byte for byte, for every nonce-vectors.json accept row', () => {
  for (const row of fixture.accept) {
    const nonce = nonceFromAcceptPrompt(row.prompt)
    assert.equal(buildPrompt(nonce), row.prompt)
  }
})

test('rotate() launches normally for every accept row nonce', () => {
  const calls = []
  for (const row of fixture.accept) {
    const nonce = nonceFromAcceptPrompt(row.prompt)
    const result = rotate(
      { host: 'cli', cwd: '/c', run_dir: '/r', nonce, settings_path: null },
      { ...OK_DEPS, exec: (...a) => { calls.push(a); return '25196' } },
    )
    assert.equal(result.ok, true)
  }
  assert.equal(calls.length, fixture.accept.length)
})

// R-9: drive every reject row. Rows flagged trim_first/after_trim_matches describe the successor's
// trim-then-match rule (C9), not a launcher input; the launcher itself must never accept a nonce
// carrying whitespace, so those two rows are asserted as still-rejected (untrimmed) here.
test('rotate-vectors.json reject rows, and every reject prompt starting with ctx-rotate: refused as a nonce', () => {
  for (const row of fixture.reject) {
    if (!row.prompt.startsWith('ctx-rotate:')) continue
    const nonce = row.prompt.slice('ctx-rotate:'.length)
    assert.equal(buildPrompt(nonce), null, `buildPrompt must refuse: ${row.reason}`)

    const calls = []
    const result = rotate(
      { host: 'cli', cwd: '/c', run_dir: '/r', nonce, settings_path: null },
      { ...OK_DEPS, exec: (...a) => { calls.push(a); return '25196' } },
    )
    assert.equal(result.ok, false, row.reason)
    assert.equal(result.pid, null, row.reason)
    assert.equal(result.error, 'bad_input', row.reason)
    assert.equal(calls.length, 0, `no opener called for a refused nonce: ${row.reason}`)

    const viaMain = main(JSON.stringify({ host: 'cli', cwd: '/c', run_dir: '/r', nonce, settings_path: null }), OK_DEPS)
    assert.equal(viaMain.exitCode, 1, row.reason)
    assert.equal(viaMain.output.error, 'bad_input', row.reason)
  }
})

test('the launcher never accepts a nonce carrying whitespace, even when trimming it would match (C9 successor-side rule, not a launcher input)', () => {
  const trimRows = fixture.reject.filter((r) => r.trim_first)
  assert.ok(trimRows.length > 0, 'fixture must carry at least one trim_first row to exercise this rule')
  for (const row of trimRows) {
    const nonce = row.prompt.slice('ctx-rotate:'.length)
    assert.notEqual(nonce.trim(), nonce, 'sanity: the vector nonce must actually carry whitespace')
    assert.equal(buildPrompt(nonce), null, `the launcher must not accept whitespace even though ${JSON.stringify(nonce.trim())} would match: ${row.reason}`)
  }
})

test('nonce whose prompt would not match the grammar refuses with bad_input and calls no opener (uppercase, wrong length, non-hex, empty)', () => {
  for (const [nonce, label] of [
    ['72EE7CCC1F06678532DE71CFCA37B36E', 'uppercase'],
    ['72ee7ccc1f06678532de71cfca37b36', '31 chars'],
    ['72ee7ccc1f06678532de71cfca37b36ea', '33 chars'],
    ['72ee7ccc1f06678532de71cfca37b3gg', 'non-hex'],
    ['', 'empty'],
  ]) {
    assert.equal(buildPrompt(nonce), null, label)
    const calls = []
    const result = rotate(
      { host: 'cli', cwd: '/c', run_dir: '/r', nonce, settings_path: null },
      { ...OK_DEPS, exec: (...a) => { calls.push(a); return '25196' } },
    )
    assert.equal(result.ok, false, label)
    assert.equal(result.pid, null, label)
    assert.equal(result.error, 'bad_input', label)
    assert.equal(calls.length, 0, label)
  }
})
