const { test } = require('node:test')
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const path = require('node:path')

const realExecFileSync = childProcess.execFileSync
childProcess.execFileSync = () => '1234'

const { spawn, terminalOpener, foregroundScript } = require('../spawn-tab.cjs')

process.once('exit', () => {
  childProcess.execFileSync = realExecFileSync
})

function commandFromCall(call) {
  return call.flat(Infinity).find((value) => typeof value === 'string' && value.includes('-FilePath'))
}

function escapedForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('win32 terminal opener resolves WindowsApps wt.exe and reports its pid', () => {
  const cwd = 'C:\\work\\handoff'
  const localAppData = 'C:\\Users\\test\\AppData\\Local'
  const terminalExe = path.win32.join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe')
  const calls = []

  const result = terminalOpener(cwd, {
    exec: (...args) => {
      calls.push(args)
      return '1234'
    },
    platform: 'win32',
    env: { LOCALAPPDATA: localAppData },
    existsSync: (candidate) => {
      assert.equal(candidate, terminalExe)
      return true
    },
  })

  assert.equal(result, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'powershell')
  const command = commandFromCall(calls[0])
  assert.ok(command)
  assert.match(command, /-FilePath/)
  assert.match(command, new RegExp(escapedForRegExp(terminalExe)))
  assert.match(command, /-PassThru/)
  assert.match(command, new RegExp(escapedForRegExp(cwd)))
  assert.match(command, /claude/)
})

test('HANDOFF_TERMINAL_EXE overrides the win32 terminal path', () => {
  const override = 'D:\\Tools\\wt.exe'
  const calls = []

  terminalOpener('C:\\work\\handoff', {
    exec: (...args) => {
      calls.push(args)
      return '5678'
    },
    platform: 'win32',
    env: {
      HANDOFF_TERMINAL_EXE: override,
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    },
    existsSync: () => {
      throw new Error('existsSync should not be used for an explicit override')
    },
  })

  const command = commandFromCall(calls[0])
  assert.ok(command)
  assert.match(command, new RegExp(escapedForRegExp(override)))
})

test('terminal opener single-quotes the directory for PowerShell', () => {
  const cwd = "C:\\tmp\\cost$env:USERNAME\\it's"
  const calls = []

  terminalOpener(cwd, {
    exec: (...args) => {
      calls.push(args)
      return '1234'
    },
    platform: 'win32',
    env: { HANDOFF_TERMINAL_EXE: 'C:\\Tools\\wt.exe' },
    existsSync: () => true,
  })

  const command = commandFromCall(calls[0])
  assert.ok(command)
  assert.ok(command.includes("'C:\\tmp\\cost$env:USERNAME\\it''s'"))
  assert.equal(command.includes(`"${cwd}"`), false)
})

test('terminal opener throws when PowerShell returns no numeric pid', () => {
  for (const output of ['', 'started']) {
    assert.throws(() => terminalOpener('C:\\work\\handoff', {
      exec: () => output,
      platform: 'win32',
      env: { HANDOFF_TERMINAL_EXE: 'C:\\Tools\\wt.exe' },
      existsSync: () => true,
    }))
  }
})

test('terminal opener rejects numeric warning text and accepts a BOM-wrapped pid', () => {
  for (const output of ['warning 123', 'terminal startup retry 1']) {
    assert.throws(() => terminalOpener('C:\\work\\handoff', {
      exec: () => output,
      platform: 'win32',
      env: { HANDOFF_TERMINAL_EXE: 'C:\\Tools\\wt.exe' },
      existsSync: () => true,
    }))
  }

  assert.equal(terminalOpener('C:\\work\\handoff', {
    exec: () => '\ufeff1234\r\n',
    platform: 'win32',
    env: { HANDOFF_TERMINAL_EXE: 'C:\\Tools\\wt.exe' },
    existsSync: () => true,
  }), true)
})

test('terminal spawn falls back to manual when the terminal opener throws', () => {
  const result = spawn({
    mode: 'terminal',
    cwd: 'C:\\work\\handoff',
    openers: {
      terminal: () => { throw new Error('no pid') },
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mode, 'manual')
})

test('foregroundScript treats folder basenames as literals in PowerShell', () => {
  const wildcardScript = foregroundScript('build[1]')
  assert.ok(
    wildcardScript.includes('[WildcardPattern]::Escape') ||
      /\.(?:Contains|IndexOf)\(/.test(wildcardScript),
  )
  assert.doesNotMatch(wildcardScript, /-like\s+["']\*[^"']*\[1\][^"']*\*["']/)

  const quotedScript = foregroundScript("builder's")
  assert.match(quotedScript, /builder''s/)
})

test('foregroundScript never matches an empty basename and compares case-insensitively', () => {
  const emptyScript = foregroundScript('')
  const whileIndex = emptyScript.indexOf('while ')
  const firstExitIndex = emptyScript.indexOf('exit 1')
  assert.ok(firstExitIndex >= 0 && firstExitIndex < whileIndex)

  const matchingScript = foregroundScript('Panel')
  assert.match(
    matchingScript,
    /IndexOf\(\$target,\s*\[StringComparison\]::OrdinalIgnoreCase\)|ToLowerInvariant\(\)/,
  )
})
