const { test } = require('node:test')
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fixture = require('./fixtures/launcher-argv.json')

// F3/item 4: rotate.cjs's default cursor-window enumeration (countCursorWindows) destructures
// execFileSync from node:child_process at module top level and calls it directly, never through the
// per-call injected deps. Intercepting it here, before rotate.cjs/spawn-tab.cjs are required (both
// destructure execFileSync at their own top level), is the only way the F3/item-4/D5 tests below can
// exercise the real default function deterministically without ever spawning a real PowerShell
// process. Restored at process exit, same pattern as terminal-opener.test.cjs.
const realExecFileSync = childProcess.execFileSync
let ambientExecCalls = []
let ambientExecReturn = '0'
let ambientExecThrows = null
childProcess.execFileSync = (...args) => {
  ambientExecCalls.push(args)
  if (ambientExecThrows) throw ambientExecThrows
  return ambientExecReturn
}
function resetAmbientExec() { ambientExecCalls = []; ambientExecReturn = '0'; ambientExecThrows = null }
process.once('exit', () => { childProcess.execFileSync = realExecFileSync })

const { rotate } = require('../rotate.cjs')
const spawnTab = require('../spawn-tab.cjs')

// D4: fixture copied locally (byte-identical, verified by sha256; see the gate report).
const INPUT = { ...fixture.launcher_contract.vectors[2].input } // { host:'cursor', cwd, run_dir, nonce, settings_path }

// R-5: openWindow(cwd) then waitForeground(cwd) then fire the URI, in that order; uri-target
// (fixed sleep / focus opener) is NEVER used. Item 6: made discriminating by recording focus/sleep
// into the SAME call log (instead of throwing, which would only prove they weren't reached by
// accident) and asserting the log is exactly the window sequence, plus that rotate.cjs's cursor
// path never reaches spawn-tab.cjs's spawn() dispatcher (the function whose 'uri-target' branch
// owns the fixed sleep and focus opener).
test('R-5/item 6 cursor host runs openWindow -> waitForeground -> fireUri, in order, mode is cursor, and never touches uri-target/spawn()', () => {
  const calls = []
  const originalSpawn = spawnTab.spawn
  let spawnCalled = false
  spawnTab.spawn = (...args) => { spawnCalled = true; return originalSpawn(...args) }
  let result
  try {
    result = rotate(INPUT, {
      cursorWindowCount: () => 0,
      openWindow: (cwd) => { calls.push(['openWindow', cwd]) },
      waitForeground: (cwd) => { calls.push(['waitForeground', cwd]); return true },
      fireUri: (nonce) => { calls.push(['fireUri', nonce]) },
      focus: (cwd) => { calls.push(['focus', cwd]) },
      sleep: (ms) => { calls.push(['sleep', ms]) },
    })
  } finally {
    spawnTab.spawn = originalSpawn
  }
  assert.deepEqual(calls.map((c) => c[0]), ['openWindow', 'waitForeground', 'fireUri'], 'no focus or sleep call may appear in the log')
  assert.equal(calls[0][1], INPUT.cwd)
  assert.equal(calls[1][1], INPUT.cwd)
  assert.equal(result.mode, 'cursor')
  assert.equal(result.ok, true)
  assert.equal(spawnCalled, false, "rotate.cjs's cursor path must drive openWindow/waitForeground/fireUri directly, never through spawn-tab.cjs's spawn() (which owns the uri-target branch)")
})

test('R-5 count of exactly one window proceeds (not just zero)', () => {
  const calls = []
  const result = rotate(INPUT, {
    cursorWindowCount: () => 1,
    openWindow: () => { calls.push('openWindow') },
    waitForeground: () => { calls.push('waitForeground'); return true },
    fireUri: () => { calls.push('fireUri') },
  })
  assert.deepEqual(calls, ['openWindow', 'waitForeground', 'fireUri'])
  assert.equal(result.ok, true)
})

// R-6: more than one Cursor window on cwd => halt:launch_failed multi_window, exit 1, none of
// openWindow/waitForeground/fireUri called. The error STRING is launcher-argv.json
// cursor.single_window_guard composed as "halt:launch_failed multi_window" (fixture vector 3
// expected_output.error); the slice brief's shorter "multi_window" loses to the fixture, which is
// the machine-readable half of the contract (C19).
test('R-6 more than one cursor window on cwd => halt:launch_failed multi_window, no opener called', () => {
  const calls = []
  const result = rotate(INPUT, {
    cursorWindowCount: () => 2,
    openWindow: () => { calls.push('openWindow') },
    waitForeground: () => { calls.push('waitForeground') },
    fireUri: () => { calls.push('fireUri') },
  })
  assert.deepEqual(calls, [])
  assert.deepEqual(result, { ok: false, mode: 'cursor', pid: null, error: 'halt:launch_failed multi_window' })
  assert.equal(result.error, fixture.cursor.single_window_guard.trigger + ' ' + fixture.cursor.single_window_guard.reason)
})

test('R-6 vector 3 of launcher-argv.json reproduced exactly', () => {
  const vector3 = fixture.launcher_contract.vectors[2]
  const result = rotate(
    { host: vector3.input.host, cwd: vector3.input.cwd, run_dir: vector3.input.run_dir, nonce: vector3.input.nonce, settings_path: vector3.input.settings_path },
    { cursorWindowCount: () => 2, openWindow: () => { throw new Error('unreached') }, waitForeground: () => { throw new Error('unreached') }, fireUri: () => { throw new Error('unreached') } },
  )
  assert.deepEqual(result, vector3.expected_output)
})

// R-7: cursorWindowCount throwing fails closed with a distinct error code (conductor's ruling,
// no code named by the contract for this path).
test('R-7 cursorWindowCount throwing fails closed with halt:launch_failed window_enum_failed', () => {
  const calls = []
  const result = rotate(INPUT, {
    cursorWindowCount: () => { throw new Error('enumeration backend unavailable') },
    openWindow: () => { calls.push('openWindow') },
    waitForeground: () => { calls.push('waitForeground') },
    fireUri: () => { calls.push('fireUri') },
  })
  assert.deepEqual(calls, [])
  assert.deepEqual(result, { ok: false, mode: 'cursor', pid: null, error: 'halt:launch_failed window_enum_failed' })
})

// D3 (conductor ruling, P1): waitForeground returning false means the target window was not
// confirmed in front, so the URI would land in whatever window is active. Refuse closed instead of
// firing it.
test('D3 (P1): waitForeground returning false refuses with halt:launch_failed foreground_not_confirmed, fireUri never called', () => {
  const calls = []
  const result = rotate(INPUT, {
    cursorWindowCount: () => 0,
    openWindow: (cwd) => { calls.push(['openWindow', cwd]) },
    waitForeground: (cwd) => { calls.push(['waitForeground', cwd]); return false },
    fireUri: () => { calls.push('fireUri') },
  })
  assert.deepEqual(calls, [['openWindow', INPUT.cwd], ['waitForeground', INPUT.cwd]])
  assert.deepEqual(result, { ok: false, mode: 'cursor', pid: null, error: 'halt:launch_failed foreground_not_confirmed' })
})

test('D3 (P1): waitForeground throwing also refuses with halt:launch_failed foreground_not_confirmed, fireUri never called', () => {
  const calls = []
  const result = rotate(INPUT, {
    cursorWindowCount: () => 0,
    openWindow: (cwd) => { calls.push(['openWindow', cwd]) },
    waitForeground: () => { calls.push('waitForeground-throws'); throw new Error('foreground poll failed') },
    fireUri: () => { calls.push('fireUri') },
  })
  assert.deepEqual(calls, [['openWindow', INPUT.cwd], 'waitForeground-throws'])
  assert.deepEqual(result, { ok: false, mode: 'cursor', pid: null, error: 'halt:launch_failed foreground_not_confirmed' })
})

// Item 5 (review finding): the deny-list is proven for the CLI host only, because rotate.cjs's
// cursor branch never threads an env to its openers (they call spawn-tab.cjs's childEnv()
// internally with no argument, defaulting to process.env, invisible to injected deps.env). Inject
// openers that record whatever env argument they were called with; the assertion carries evidence
// by refusing to pass on an opener call with no env argument at all.
test('item 5: the Cursor path threads a deny-listed child env to its openers too, not just the CLI host', () => {
  const dirtyEnv = { PATH: '/usr/bin', CLAUDE_CODE_SESSION_ID: 'abc', CLAUDECODE: '1', ELECTRON_RUN_AS_NODE: '1' }
  const seenEnvs = {}
  rotate(INPUT, {
    env: dirtyEnv,
    cursorWindowCount: () => 0,
    openWindow: (cwd, env) => { seenEnvs.openWindow = env },
    waitForeground: (cwd, env) => { seenEnvs.waitForeground = env; return true },
    fireUri: (nonce, env) => { seenEnvs.fireUri = env },
  })
  for (const opener of ['openWindow', 'waitForeground', 'fireUri']) {
    const env = seenEnvs[opener]
    assert.ok(env, `${opener} must receive a child env argument so the C10 deny-list can be verified against it (rotate.cjs currently calls it with no env at all)`)
    assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined, `${opener}: CLAUDE_CODE_* must be stripped`)
    assert.equal(env.CLAUDECODE, undefined, `${opener}: CLAUDECODE must be stripped`)
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined, `${opener}: ELECTRON_RUN_AS_NODE must be stripped`)
    assert.equal(env.PATH, '/usr/bin', `${opener}: other keys must survive`)
  }
})

// F3 (review finding, P1): the default cursorWindowCount computes Number(output.trim()) || 0,
// which turns empty output, a decorated PowerShell result (a warning/progress line, a localized
// value) or a non-numeric string into 0 -- the guard then reads count > 1 as false and silently
// proceeds. Only a thrown exception fails closed today. None of these outputs are a bare
// non-negative integer, so all six must fail closed instead.
const BAD_ENUMERATION_OUTPUTS = [
  ['empty string', ''],
  ['whitespace only', '   '],
  ['decorated with a warning line', '2\r\nWARNING: something'],
  ['non-numeric word', 'banana'],
  ['negative number', '-5'],
  ['the string "NaN"', 'NaN'],
]

test('F3 (P1): enumeration output that is not a bare non-negative integer fails CLOSED, not open', () => {
  for (const [label, output] of BAD_ENUMERATION_OUTPUTS) {
    resetAmbientExec()
    ambientExecReturn = output
    const calls = []
    const result = rotate(INPUT, {
      platform: 'win32',
      openWindow: () => { calls.push('openWindow') },
      waitForeground: () => { calls.push('waitForeground'); return true },
      fireUri: () => { calls.push('fireUri') },
    })
    assert.deepEqual(calls, [], `${label} (${JSON.stringify(output)}): no opener may run when enumeration output cannot be trusted`)
    assert.deepEqual(result, { ok: false, mode: 'cursor', pid: null, error: 'halt:launch_failed window_enum_failed' }, `${label} (${JSON.stringify(output)})`)
  }
})

test('F3: a bare 0 or 1 proceeds to the window sequence (0 is legitimate; openWindow creates the window)', () => {
  for (const output of ['0', '1']) {
    resetAmbientExec()
    ambientExecReturn = output
    const calls = []
    const result = rotate(INPUT, {
      platform: 'win32',
      openWindow: () => { calls.push('openWindow') },
      waitForeground: () => { calls.push('waitForeground'); return true },
      fireUri: () => { calls.push('fireUri') },
    })
    assert.deepEqual(calls, ['openWindow', 'waitForeground', 'fireUri'], `output ${JSON.stringify(output)} must proceed`)
    assert.equal(result.ok, true, `output ${JSON.stringify(output)}`)
  }
})

test('F3: a bare 2, parsed end to end from real enumeration output text (not an injected integer), still refuses with halt:launch_failed multi_window', () => {
  resetAmbientExec()
  ambientExecReturn = '2'
  const calls = []
  const result = rotate(INPUT, {
    platform: 'win32',
    openWindow: () => { calls.push('openWindow') },
    waitForeground: () => { calls.push('waitForeground') },
    fireUri: () => { calls.push('fireUri') },
  })
  assert.deepEqual(calls, [])
  assert.deepEqual(result, { ok: false, mode: 'cursor', pid: null, error: 'halt:launch_failed multi_window' })
})

// Item 4 (review finding): the enumeration must go through the injected deps, not the ambient
// process. deps.platform is win32 here (matching the real ambient OS, so this test isolates the
// exec-wiring question from the platform-SOURCE question the D5 test below covers) and deps.exec
// records its calls. This fails today: rotate.cjs calls its default cursorWindowCount as
// d.cursorWindowCount(input.cwd), never passing `d` down, so the default function can only ever
// reach the ambient execFileSync (intercepted above purely to keep this test from spawning a real
// process) and never deps.exec.
test('item 4 (P1): the default cursor-window enumeration must go through deps.exec, not the ambient execFileSync', () => {
  resetAmbientExec()
  ambientExecReturn = '0'
  const execCalls = []
  rotate(INPUT, {
    platform: 'win32',
    exec: (...args) => { execCalls.push(args); return '0' },
    openWindow: () => {},
    waitForeground: () => true,
    fireUri: () => {},
  })
  assert.ok(execCalls.length > 0, 'the enumeration must be made through deps.exec at least once; it never is today, since rotate.cjs never passes deps down to cursorWindowCount')
})

// D5 (conductor ruling, this round): neither linux nor darwin has an enumeration implementation, so
// they must fail closed like a thrown exception does, never silently report a single window. This
// also doubles as item 4's negative case: deps.platform is 'linux'/'darwin' here while the real
// ambient process.platform (this test machine) is win32. An implementation that correctly reads
// deps.platform must fail closed regardless of the ambient OS; today it reads process.platform
// instead, takes the win32 branch, and "succeeds".
test('D5/item 4 (P1): deps.platform of linux or darwin fails closed (halt:launch_failed window_enum_failed), never a hardcoded single window', () => {
  for (const platform of ['linux', 'darwin']) {
    resetAmbientExec()
    ambientExecReturn = '0'
    const calls = []
    const result = rotate(INPUT, {
      platform,
      openWindow: () => { calls.push('openWindow') },
      waitForeground: () => { calls.push('waitForeground'); return true },
      fireUri: () => { calls.push('fireUri') },
    })
    assert.deepEqual(calls, [], `platform ${platform}: no opener may run without a real enumeration`)
    assert.deepEqual(result, { ok: false, mode: 'cursor', pid: null, error: 'halt:launch_failed window_enum_failed' }, `platform ${platform}`)
  }
})
