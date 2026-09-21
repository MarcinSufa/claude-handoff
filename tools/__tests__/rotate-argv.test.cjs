const { test } = require('node:test')
const assert = require('node:assert/strict')
const fixture = require('./fixtures/launcher-argv.json')
const { rotate, buildCliArgv } = require('../rotate.cjs')
const { terminalExe } = require('../spawn-tab.cjs')

// D4: fixture copied locally (byte-identical, verified by sha256; see the gate report), so this
// suite never depends on the coordinator worktree. Values below are read out of the fixture
// object rather than retyped as literals, so nothing here duplicates the fixture's example paths.
const CLI_SAMPLE = fixture.launcher_contract.vectors[0].input // { host:'cli', cwd, run_dir, nonce, settings_path }

// cli.argv_example carries its OWN sample nonce/cwd/paths, distinct from launcher_contract.vectors[0];
// read them out of the array itself (by the argv positions R-1 fixes) rather than retyping literals.
const ARGV_EXAMPLE = fixture.cli.argv_example
const EXAMPLE_CWD = ARGV_EXAMPLE[4]
const EXAMPLE_RUN_DIR = ARGV_EXAMPLE[8]
const EXAMPLE_NONCE = ARGV_EXAMPLE[6].slice('ctx-rotate:'.length)
const EXAMPLE_SETTINGS_PATH = ARGV_EXAMPLE[12]

function okDeps(overrides) {
  return { platform: 'win32', env: { LOCALAPPDATA: 'C:/Users/test/AppData/Local' }, existsSync: () => true, exec: () => '25196', ...overrides }
}

// R-1: exactly launcher-argv.json cli.argv_example shape, prompt first token after "claude".
test('buildCliArgv matches launcher-argv.json cli.argv_example byte for byte', () => {
  const argv = buildCliArgv({
    exe: 'wt.exe', cwd: EXAMPLE_CWD, runDir: EXAMPLE_RUN_DIR,
    nonce: EXAMPLE_NONCE, settingsPath: EXAMPLE_SETTINGS_PATH,
  })
  assert.deepEqual(argv, ARGV_EXAMPLE)
  assert.equal(argv[5], 'claude')
  assert.equal(argv[6], `ctx-rotate:${EXAMPLE_NONCE}`)
})

test('settings_path: null drops the --settings pair and nothing else', () => {
  const withSettings = buildCliArgv({
    exe: 'wt.exe', cwd: EXAMPLE_CWD, runDir: EXAMPLE_RUN_DIR,
    nonce: EXAMPLE_NONCE, settingsPath: EXAMPLE_SETTINGS_PATH,
  })
  const withoutSettings = buildCliArgv({
    exe: 'wt.exe', cwd: EXAMPLE_CWD, runDir: EXAMPLE_RUN_DIR,
    nonce: EXAMPLE_NONCE, settingsPath: null,
  })
  assert.deepEqual(withoutSettings, withSettings.slice(0, withSettings.length - 2))
  assert.ok(!withoutSettings.includes('--settings'))
  assert.equal(withoutSettings.length, withSettings.length - 2)
})

// The regression F-a guards against: --add-dir must never precede the prompt (it is variadic and
// would swallow it, per spike-P0-h hf215c7a3).
test('the bad_argv_example_regression shape never occurs: --add-dir never precedes the prompt', () => {
  const argv = buildCliArgv({
    exe: 'wt.exe', cwd: EXAMPLE_CWD, runDir: EXAMPLE_RUN_DIR,
    nonce: EXAMPLE_NONCE, settingsPath: EXAMPLE_SETTINGS_PATH,
  })
  const claudeIdx = argv.indexOf('claude')
  const promptIdx = claudeIdx + 1
  const addDirIdx = argv.indexOf('--add-dir')
  assert.ok(claudeIdx >= 0)
  assert.equal(argv[promptIdx], `ctx-rotate:${EXAMPLE_NONCE}`)
  assert.ok(addDirIdx > promptIdx, 'the bad regression puts --add-dir before the prompt')
  assert.notDeepEqual(argv.slice(claudeIdx), fixture.cli.bad_argv_example_regression)
})

// D2 (conductor ruling): every launch failure returns "halt:launch_failed <reason>" with a single
// space, so the exo-vault hook maps it to the C7 trigger by taking the text before the space.
// A pid assertion failure is specifically "halt:launch_failed pid_assertion" (it used to be bare
// "launch_failed").
test('D2/R-3 non-numeric or empty Start-Process output => halt:launch_failed pid_assertion, exit 1', () => {
  for (const badOutput of ['', 'started', 'warning 123']) {
    const result = rotate(
      { host: 'cli', cwd: CLI_SAMPLE.cwd, run_dir: CLI_SAMPLE.run_dir, nonce: CLI_SAMPLE.nonce, settings_path: null },
      okDeps({ exec: () => badOutput }),
    )
    assert.deepEqual(result, { ok: false, mode: 'terminal', pid: null, error: 'halt:launch_failed pid_assertion' })
  }
})

test('R-3 a numeric pid from Start-Process -PassThru => ok true, exit-worthy pid', () => {
  const result = rotate(
    { host: 'cli', cwd: CLI_SAMPLE.cwd, run_dir: CLI_SAMPLE.run_dir, nonce: CLI_SAMPLE.nonce, settings_path: null },
    okDeps(),
  )
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'terminal')
  assert.equal(result.pid, 25196)
  assert.equal(result.error, null)
})

// D2: the generic catch (anything else that throws inside rotate()) is "halt:launch_failed spawn_threw".
test('D2 generic catch: d.exec throwing => halt:launch_failed spawn_threw, exit 1', () => {
  const result = rotate(
    { host: 'cli', cwd: CLI_SAMPLE.cwd, run_dir: CLI_SAMPLE.run_dir, nonce: CLI_SAMPLE.nonce, settings_path: null },
    okDeps({ exec: () => { throw new Error('powershell.exe not found') } }),
  )
  assert.deepEqual(result, { ok: false, mode: 'terminal', pid: null, error: 'halt:launch_failed spawn_threw' })
})

// Item 1 (review finding): every prior argv assertion ran only against the pure buildCliArgv, so
// nothing asserted what deps.exec actually receives on the wt.exe path. Capture the exec call and
// decode the FULL argv reaching it, element by element, from the PowerShell -ArgumentList literal
// array (not a regex over the joined script string).
function decodeQuotedTokens(script) {
  const tokens = []
  const re = /'((?:[^']|'')*)'/g
  let m
  while ((m = re.exec(script))) tokens.push(m[1].replace(/''/g, "'"))
  return tokens
}

test('item 1: the wt.exe path threads the full argv to exec, element by element, in order', () => {
  let capturedCmd, capturedArgs
  const deps = okDeps({ exec: (cmd, args) => { capturedCmd = cmd; capturedArgs = args; return '25196' } })
  rotate({ host: 'cli', cwd: CLI_SAMPLE.cwd, run_dir: CLI_SAMPLE.run_dir, nonce: CLI_SAMPLE.nonce, settings_path: CLI_SAMPLE.settings_path }, deps)

  assert.equal(capturedCmd, 'powershell')
  const script = capturedArgs[2]
  const decodedArgv = decodeQuotedTokens(script)

  const expectedExe = terminalExe(deps)
  const expectedArgv = buildCliArgv({
    exe: expectedExe, cwd: CLI_SAMPLE.cwd, runDir: CLI_SAMPLE.run_dir,
    nonce: CLI_SAMPLE.nonce, settingsPath: CLI_SAMPLE.settings_path,
  })
  assert.deepEqual(decodedArgv, expectedArgv, 'the argv that reaches exec must equal buildCliArgv output, element by element')
})

// R-4: wt.exe absent falls back to `powershell Start-Process claude` with the SAME argv tail.
// launcher-argv.json vector 2 pairs ok:false with expected_exit_code:0, which contradicts C10
// ("exit 0 only on ok:true") and the fixture's own `note` admits the row documents the trigger
// condition, not the literal output pair. This test asserts the RULE, not that row's pair.
test('R-4 wt.exe absent: fallback runs powershell Start-Process claude with the same argv tail, mode stays terminal', () => {
  const calls = []
  const result = rotate(
    { host: 'cli', cwd: CLI_SAMPLE.cwd, run_dir: CLI_SAMPLE.run_dir, nonce: CLI_SAMPLE.nonce, settings_path: null },
    okDeps({ existsSync: () => false, exec: (cmd, args) => { calls.push({ cmd, args }); return '99999' } }),
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, 'powershell')
  const script = calls[0].args.join(' ')
  assert.match(script, /Start-Process/)
  assert.match(script, /claude/)
  assert.match(script, new RegExp(`ctx-rotate:${CLI_SAMPLE.nonce}`))
  assert.match(script, /--add-dir/)
  assert.match(script, /acceptEdits/)
  assert.equal(result.mode, 'terminal')
  assert.equal(result.ok, true)
  assert.equal(result.pid, 99999)
})

// Item 2 (review finding, P1 #2): assert.match on a joined script still passes with the working
// directory dropped entirely. Assert the fallback's argv element by element AND that the cwd
// reaches the shell as its own argument (e.g. -WorkingDirectory <cwd>), not merely somewhere in
// the blob.
test('item 2 (P1): the fallback carries the target directory as its own argument, not just the claude argv tail', () => {
  let capturedArgs
  rotate(
    { host: 'cli', cwd: CLI_SAMPLE.cwd, run_dir: CLI_SAMPLE.run_dir, nonce: CLI_SAMPLE.nonce, settings_path: CLI_SAMPLE.settings_path },
    okDeps({ existsSync: () => false, exec: (cmd, args) => { capturedArgs = args; return '99999' } }),
  )
  const script = capturedArgs[2]
  const decoded = decodeQuotedTokens(script)
  const expectedTail = buildCliArgv({
    exe: 'wt.exe', cwd: CLI_SAMPLE.cwd, runDir: CLI_SAMPLE.run_dir,
    nonce: CLI_SAMPLE.nonce, settingsPath: CLI_SAMPLE.settings_path,
  }).slice(6) // prompt onward, same tail R-4 already asserts
  const exeToken = decoded[0]
  assert.equal(exeToken, 'claude')
  assert.deepEqual(decoded.slice(1, 1 + expectedTail.length), expectedTail, 'the claude argv tail must still be exact')
  assert.ok(
    decoded.includes(CLI_SAMPLE.cwd) || script.includes('-WorkingDirectory'),
    `the target directory ${JSON.stringify(CLI_SAMPLE.cwd)} must reach the shell as its own argument (e.g. -WorkingDirectory), not be dropped: script was ${JSON.stringify(script)}`,
  )
})

test('R-4 wt.exe absent AND the fallback Start-Process fails => ok false, exit code mirrors ok', () => {
  const result = rotate(
    { host: 'cli', cwd: CLI_SAMPLE.cwd, run_dir: CLI_SAMPLE.run_dir, nonce: CLI_SAMPLE.nonce, settings_path: null },
    okDeps({ existsSync: () => false, exec: () => '' }),
  )
  assert.equal(result.ok, false)
  assert.equal(result.mode, 'terminal')
  assert.equal(result.pid, null)
})

// Item 3 (P1 #1, quoting): the current construction PowerShell-single-quotes each argv element for
// the -ArgumentList array literal, but Start-Process's -ArgumentList (a plain string[] parameter,
// not .NET's ProcessStartInfo.ArgumentList) joins that array with plain spaces before building the
// child's command line, with no re-quoting. A value containing a space therefore splits into two
// child argv tokens unless something (e.g. embedded double quotes) protects it. Simulated here with
// a Windows-argv tokenizer, since no real PowerShell process runs in this test.
function winArgvSplit(commandLine) {
  const tokens = []
  let i = 0
  while (i < commandLine.length) {
    while (i < commandLine.length && commandLine[i] === ' ') i += 1
    if (i >= commandLine.length) break
    let token = ''
    let inQuotes = false
    while (i < commandLine.length && (inQuotes || commandLine[i] !== ' ')) {
      if (commandLine[i] === '"') { inQuotes = !inQuotes; i += 1; continue }
      token += commandLine[i]; i += 1
    }
    tokens.push(token)
  }
  return tokens
}
function decodeArgumentListElements(script) {
  const m = script.match(/-ArgumentList (.*) -PassThru/)
  assert.ok(m, `script must carry -ArgumentList ... -PassThru: ${script}`)
  const src = m[1]
  const elements = []
  let cur = ''; let inQuote = false
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]
    if (c === "'") {
      if (inQuote && src[i + 1] === "'") { cur += "'"; i += 1; continue }
      inQuote = !inQuote
      continue
    }
    if (c === ',' && !inQuote) { elements.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur) elements.push(cur)
  return elements
}

test('item 3 (P1 #1): a cwd/run_dir containing a space reaches the child as ONE argv token, not split on the space', () => {
  const cwd = 'C:/Users/x/agent test/p0-h'
  const runDir = 'C:/Users/x/agent test/p0-h/.exovault/runs'
  let capturedArgs
  rotate(
    { host: 'cli', cwd, run_dir: runDir, nonce: CLI_SAMPLE.nonce, settings_path: null },
    okDeps({ exec: (cmd, args) => { capturedArgs = args; return '25196' } }),
  )
  const elements = decodeArgumentListElements(capturedArgs[2])
  // Start-Process's real (documented) behaviour: -ArgumentList as a string[] is joined with plain
  // spaces, then CreateProcess re-tokenizes that single command line.
  const childArgv = winArgvSplit(elements.join(' '))
  assert.equal(
    childArgv.length, elements.length,
    `a space inside cwd/run_dir must not produce extra child argv tokens once Start-Process joins -ArgumentList with spaces; got ${JSON.stringify(childArgv)} from ${JSON.stringify(elements)}`,
  )
  assert.ok(childArgv.includes(cwd), `cwd must survive as one token: ${JSON.stringify(childArgv)}`)
  assert.ok(childArgv.includes(runDir), `run_dir must survive as one token: ${JSON.stringify(childArgv)}`)
})

test('item 3: a cwd containing a single quote still round-trips to the exact original value', () => {
  const cwd = "C:/Users/x/it's/p0-h"
  let capturedArgs
  rotate(
    { host: 'cli', cwd, run_dir: CLI_SAMPLE.run_dir, nonce: CLI_SAMPLE.nonce, settings_path: null },
    okDeps({ exec: (cmd, args) => { capturedArgs = args; return '25196' } }),
  )
  const elements = decodeArgumentListElements(capturedArgs[2])
  assert.ok(elements.includes(cwd), `the single quote must round-trip through PowerShell escaping unchanged: ${JSON.stringify(elements)}`)
})

// Item 4 (review finding): on non-win32, the current code passes argv.slice(1) unconditionally,
// which for the wt.exe-shaped argv ships "-w new -d <cwd> claude <prompt> ..." to the claude binary
// itself. The fallback argv on linux/darwin must be the claude argv with the prompt FIRST.
test('item 4: non-win32 (linux, darwin) CLI ships the claude argv with the prompt first, never the wt.exe argv', () => {
  for (const platform of ['linux', 'darwin']) {
    let capturedCmd, capturedArgs
    rotate(
      { host: 'cli', cwd: CLI_SAMPLE.cwd, run_dir: CLI_SAMPLE.run_dir, nonce: CLI_SAMPLE.nonce, settings_path: null },
      { platform, env: {}, existsSync: () => false, exec: (cmd, args) => { capturedCmd = cmd; capturedArgs = args; return '25196' } },
    )
    assert.equal(capturedCmd, 'claude', `platform ${platform}`)
    assert.equal(capturedArgs[0], `ctx-rotate:${CLI_SAMPLE.nonce}`, `platform ${platform}: the prompt must be the first arg to claude, not a wt.exe flag`)
    assert.ok(!capturedArgs.includes('-w'), `platform ${platform}: the wt.exe -w flag must never reach claude`)
    assert.ok(!capturedArgs.includes('-d'), `platform ${platform}: the wt.exe -d flag must never reach claude`)
  }
})
