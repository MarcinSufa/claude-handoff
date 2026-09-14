const { test } = require('node:test'); const assert = require('node:assert')
const { buildUri, spawn } = require('../spawn-tab.cjs')

test('buildUri encodes the prompt backstop', () => {
  const uri = buildUri('cursor', 'read HANDOFF.md & continue')
  assert.ok(uri.startsWith('cursor://anthropic.claude-code/open?prompt='))
  assert.ok(uri.includes('%20') && !uri.includes(' '))
})
test('uri-target: uri opener succeeds -> mode uri-target', () => {
  const r = spawn({ mode: 'uri-target', scheme: 'cursor', prompt: 'hi', cwd: '/p', openers: { uri: () => true, terminal: () => { throw new Error('unreached') } } })
  assert.equal(r.ok, true); assert.equal(r.mode, 'uri-target')
})
test('uri-target: uri fails -> falls through to terminal (CLI)', () => {
  const r = spawn({ mode: 'uri-target', scheme: 'cursor', prompt: 'hi', cwd: '/p', openers: { uri: () => { throw new Error('no handler') }, terminal: () => true } })
  assert.equal(r.ok, true); assert.equal(r.mode, 'terminal')
})
test('both fail -> universal fallback (ok:false, "start a fresh claude")', () => {
  const r = spawn({ scheme: 'cursor', prompt: 'hi', cwd: '/p', doc: '/p/.claude/handoff/HANDOFF.md', openers: { uri: () => { throw new Error() }, terminal: () => { throw new Error() } } })
  assert.equal(r.ok, false); assert.match(r.message, /start a fresh `?claude/i)
})
test('mode=none -> straight to fallback, openers never called', () => {
  const r = spawn({ mode: 'none', prompt: 'hi', cwd: '/p', openers: { uri: () => { throw 1 }, terminal: () => { throw 1 } } })
  assert.equal(r.ok, false)
})
