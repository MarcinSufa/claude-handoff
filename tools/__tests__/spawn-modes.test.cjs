const { test } = require('node:test')
const assert = require('node:assert')
const { spawn } = require('../spawn-tab.cjs')

test('default mode is same-window and fires uri without focusing', () => {
  const previous = process.env.HANDOFF_SPAWN
  delete process.env.HANDOFF_SPAWN
  try {
    const calls = []
    const r = spawn({ scheme: 'cursor', prompt: 'hi', cwd: '/p', openers: {
      focus: (cwd) => { calls.push('focus:' + cwd) },
      uri: () => { calls.push('uri'); return true },
      terminal: () => { calls.push('terminal'); return true },
    } })
    assert.deepEqual(calls, ['uri'])
    assert.equal(r.mode, 'same-window')
  } finally {
    if (previous === undefined) delete process.env.HANDOFF_SPAWN
    else process.env.HANDOFF_SPAWN = previous
  }
})

test('uri-target and legacy uri modes focus before uri', () => {
  for (const mode of ['uri-target', 'auto', 'uri']) {
    const calls = []
    const r = spawn({ mode, scheme: 'cursor', prompt: 'hi', cwd: '/p', openers: {
      focus: (cwd) => { calls.push('focus:' + cwd) },
      uri: () => { calls.push('uri'); return true },
      terminal: () => { throw new Error('unreached') },
    } })
    assert.equal(r.ok, true)
    assert.equal(r.mode, 'uri-target')
    assert.deepEqual(calls, ['focus:/p', 'uri'], mode)
  }
})

test('spawn field overrides HANDOFF_SPAWN', () => {
  const previous = process.env.HANDOFF_SPAWN
  process.env.HANDOFF_SPAWN = 'terminal'
  try {
    const calls = []
    const r = spawn({ mode: 'same-window', scheme: 'cursor', prompt: 'hi', cwd: '/p', openers: {
      focus: () => { calls.push('focus') },
      uri: () => { calls.push('uri'); return true },
      terminal: () => { calls.push('terminal'); return true },
    } })
    assert.equal(r.mode, 'same-window')
    assert.deepEqual(calls, ['uri'])
  } finally {
    if (previous === undefined) delete process.env.HANDOFF_SPAWN
    else process.env.HANDOFF_SPAWN = previous
  }
})

test('same-window registry failure returns manual fallback without trying terminal', () => {
  const calls = []
  const result = spawn({
    mode: 'same-window', registryFailed: true, doc: '/target/HANDOFF.md',
    openers: {
      uri: () => { calls.push('uri'); throw new Error('uri failed') },
      terminal: () => { calls.push('terminal'); throw new Error('must not be called') },
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mode, 'manual')
  assert.match(result.message, /Handoff saved/)
  assert.deepEqual(calls, ['uri'])

  const normalCalls = []
  const normalResult = spawn({
    mode: 'same-window',
    openers: {
      uri: () => { normalCalls.push('uri'); throw new Error('uri failed') },
      terminal: () => { normalCalls.push('terminal'); return true },
    },
  })

  assert.equal(normalResult.ok, true)
  assert.equal(normalResult.mode, 'terminal')
  assert.deepEqual(normalCalls, ['uri', 'terminal'])
})

test('same-window registry failure tells the user to start claude in targetCwd', () => {
  const result = spawn({
    mode: 'same-window', registryFailed: true, cwd: '/caller', targetCwd: '/target',
    doc: '/target/.claude/handoff/HANDOFF.md', openers: {
      uri: () => { throw new Error() },
      terminal: () => { throw new Error('unreached') },
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mode, 'manual')
  assert.match(result.message, /\/target/)
  assert.match(result.message, /\/target\/\.claude\/handoff\/HANDOFF\.md/)
  assert.ok(/\bcd\s+\/target\b.*\bclaude\b/i.test(result.message) || /\/target(?:\s|[`'\"]|$)[\s\S]*\bclaude\b/i.test(result.message))
  assert.doesNotMatch(result.message, /auto-resume/i)
  assert.doesNotMatch(result.message, /in this directory/i)
})

test('window mode opens the target window, waits for focus, then fires uri', () => {
  const calls = []
  const target = '/target'
  const r = spawn({ mode: 'window', scheme: 'cursor', prompt: 'hi', cwd: target, openers: {
    openWindow: (cwd) => { calls.push('openWindow:' + cwd); return true },
    waitForeground: (cwd) => { calls.push('waitForeground:' + cwd); return true },
    uri: () => { calls.push('uri'); return true },
  } })
  assert.deepEqual(calls, ['openWindow:/target', 'waitForeground:/target', 'uri'])
  assert.deepEqual({ mode: r.mode, focused: r.focused }, { mode: 'window', focused: true })
})

test('window mode fires uri after foreground wait timeout and reports unfocused', () => {
  const calls = []
  const r = spawn({ mode: 'window', scheme: 'cursor', prompt: 'hi', cwd: '/target', openers: {
    openWindow: () => { calls.push('openWindow'); return true },
    waitForeground: () => { calls.push('waitForeground'); return false },
    uri: () => { calls.push('uri'); return true },
  } })
  assert.deepEqual(calls, ['openWindow', 'waitForeground', 'uri'])
  assert.equal(r.mode, 'window')
  assert.equal(r.focused, false)
})

test('terminal mode calls the terminal opener and returns terminal mode', () => {
  const calls = []
  const r = spawn({ mode: 'terminal', prompt: 'hi', cwd: '/p', openers: {
    terminal: (cwd) => { calls.push(cwd); return true },
    uri: () => { throw new Error('unreached') },
  } })
  assert.equal(r.ok, true)
  assert.equal(r.mode, 'terminal')
  assert.deepEqual(calls, ['/p'])
})

test('clear mode never calls openers and tells the user to type /clear', () => {
  const r = spawn({ mode: 'clear', prompt: 'hi', cwd: '/p', doc: '/p/.claude/handoff/HANDOFF.md', openers: {
    focus: () => { throw new Error('unreached') },
    uri: () => { throw new Error('unreached') },
    terminal: () => { throw new Error('unreached') },
  } })
  assert.equal(r.ok, true)
  assert.equal(r.mode, 'clear')
  assert.match(r.message, /State saved to \/p\/\.claude\/handoff\/HANDOFF\.md\. Type \/clear; I will continue from Next step\./)
  assert.doesNotMatch(r.message, /close (this|the old)/i)
  assert.doesNotMatch(r.message, /start (a )?fresh/i)
})

test('none mode uses the fallback and never calls openers', () => {
  const r = spawn({ mode: 'none', prompt: 'hi', cwd: '/p', openers: {
    focus: () => { throw new Error('unreached') },
    uri: () => { throw new Error('unreached') },
    terminal: () => { throw new Error('unreached') },
  } })
  assert.equal(r.ok, false)
})
