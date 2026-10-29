const { test } = require('node:test')
const assert = require('node:assert/strict')
const fixture = require('./fixtures/launcher-argv.json')
const { rotate } = require('../rotate.cjs')

const INPUT = fixture.launcher_contract.vectors[0].input

for (const platform of ['linux', 'darwin']) {
  test(`${platform} CLI rotation without herdr returns no_terminal without exec`, () => {
    const calls = []
    const result = rotate(INPUT, {
      platform,
      env: {},
      existsSync: () => false,
      exec: (...args) => { calls.push(args); return '25196' },
    })

    assert.deepEqual(result, { ok: false, mode: 'terminal', pid: null, error: 'halt:launch_failed no_terminal' })
    assert.deepEqual(calls, [])
  })
}

test('Linux CLI rotation inside herdr still opens a herdr tab', () => {
  const calls = []
  const result = rotate(INPUT, {
    platform: 'linux',
    env: { HERDR_ENV: '1' },
    existsSync: () => false,
    exec: (cmd, args) => {
      calls.push({ cmd, args })
      return args[0] === 'tab'
        ? JSON.stringify({ result: { root_pane: { pane_id: 'pane-1' } } })
        : '{}'
    },
  })

  assert.deepEqual(result, { ok: true, mode: 'herdr', pid: null, error: null })
  assert.deepEqual(calls.map(({ cmd, args }) => [cmd, args[0]]), [['herdr', 'tab'], ['herdr', 'agent']])
})

test('Windows CLI rotation still launches through PowerShell and returns its pid', () => {
  const calls = []
  const result = rotate(INPUT, {
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:/Users/test/AppData/Local' },
    existsSync: () => false,
    exec: (cmd, args, options) => { calls.push({ cmd, args, options }); return '25196' },
  })

  assert.deepEqual(result, { ok: true, mode: 'terminal', pid: 25196, error: null })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, 'powershell')
})
