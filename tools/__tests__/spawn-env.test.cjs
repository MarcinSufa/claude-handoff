const { test } = require('node:test'); const assert = require('node:assert')
const { childEnv, spawn } = require('../spawn-tab.cjs')

test('childEnv drops ELECTRON_RUN_AS_NODE so Cursor.exe boots as the editor, not as node', () => {
  const env = childEnv({ PATH: '/x', ELECTRON_RUN_AS_NODE: '1', HOME: '/h' })
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(env.PATH, '/x'); assert.equal(env.HOME, '/h')
})
test('auto cascade focuses the project window BEFORE firing the uri', () => {
  const calls = []
  const r = spawn({ scheme: 'cursor', prompt: 'hi', cwd: '/p', openers: {
    focus: (cwd) => { calls.push('focus:' + cwd) },
    uri: () => { calls.push('uri'); return true },
    terminal: () => { throw new Error('unreached') },
  } })
  assert.equal(r.mode, 'uri')
  assert.deepEqual(calls, ['focus:/p', 'uri'])
})
test('a failing focus step never blocks the uri', () => {
  const r = spawn({ scheme: 'cursor', prompt: 'hi', cwd: '/p', openers: {
    focus: () => { throw new Error('no editor exe') }, uri: () => true, terminal: () => { throw new Error() },
  } })
  assert.equal(r.mode, 'uri')
})
