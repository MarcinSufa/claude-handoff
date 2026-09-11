const { test } = require('node:test')
const assert = require('node:assert')
const { execFileSync, spawn: spawnProcess } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { handoffPaths } = require('../paths.cjs')
const { writeMarker } = require('../marker.cjs')
const { listEntries } = require('../registry.cjs')
const HANDOFF = path.join(__dirname, '..', 'handoff.cjs')

function repo(prefix = 'ho-cli-') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  fs.mkdirSync(path.join(root, '.git'))
  return root
}
function home() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-cli-home-'))) }
function payload(over = {}) {
  return {
    goal: 'Ship same window handoff', specifics: [], state: 'Ready', nextStep: 'Run the tests',
    constraints: [], gotchas: [], openQuestions: [], keepOnFail: [], verify: [], ...over,
  }
}
function run(args, options = {}) {
  return JSON.parse(execFileSync('node', [HANDOFF, ...args], {
    cwd: options.cwd,
    env: { ...process.env, HANDOFF_HOME: options.home, ...options.env },
    input: options.input == null ? '' : JSON.stringify(options.input), encoding: 'utf8',
  }))
}
function runAsync(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('node', [HANDOFF, ...args], {
      cwd: options.cwd,
      env: { ...process.env, HANDOFF_HOME: options.home, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''; let stderr = ''; let firstEntryAt = null
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const poll = setInterval(() => {
      if (firstEntryAt == null && listEntries(options.home).length > 0) firstEntryAt = Date.now()
    }, 10)
    child.once('error', (error) => { clearInterval(poll); reject(error) })
    child.once('close', (code, signal) => {
      clearInterval(poll)
      resolve({ code, signal, stdout, stderr, firstEntryAt, closedAt: Date.now() })
    })
  })
}

test('registry entry builder keeps the raw title and registry schema', () => {
  const { buildRegistryEntry } = require('../handoff-registry-entry.cjs')
  const entry = buildRegistryEntry({
    mode: 'terminal', targetCwd: 'C:\\target', callerCwd: 'C:\\caller',
    doc: 'C:\\target\\HANDOFF.md', pending: 'C:\\target\\handoff.pending.json',
    title: 'panel verdicts', generation: 2, now: '2026-09-11T12:00:00.000Z',
  })
  assert.equal(entry.schema, 'handoff-registry/v1')
  assert.equal(entry.title, 'panel verdicts')
  assert.equal(entry.createdAt, '2026-09-11T12:00:00.000Z')
})

test('spawn none reports mode and paths without writing a registry entry', () => {
  const cwd = repo(); const registryHome = home()
  const out = run([], { cwd, home: registryHome, env: { HANDOFF_SPAWN: 'none' }, input: payload({ spawn: 'none' }) })
  assert.equal(out.ok, true)
  assert.equal(out.mode, 'none')
  assert.equal(out.targetCwd, cwd)
  assert.equal(out.callerCwd, cwd)
  assert.equal(fs.existsSync(path.join(registryHome, 'pending')), false)
})

test('same-window message helper names the absolute handoff and target and leads with the tab title', () => {
  const { buildMessages } = require('../handoff-messages.cjs')
  const messages = buildMessages({
    mode: 'same-window', tabTitle: 'same window #1',
    doc: 'C:\\tmp\\target\\.claude\\handoff\\HANDOFF.md',
    targetCwd: 'C:\\tmp\\target', callerCwd: 'C:\\tmp\\caller',
  })
  assert.ok(messages.resumeMessage.includes('C:\\tmp\\target\\.claude\\handoff\\HANDOFF.md'))
  assert.ok(messages.resumeMessage.includes('C:\\tmp\\target'))
  assert.match(messages.resumeMessage, /EnterWorktree/)
  assert.ok(messages.prompt.startsWith('same window #1'))
})

test('respawn none preserves the existing HANDOFF.md and marker bytes and uses marker metadata', () => {
  const cwd = repo(); const registryHome = home(); const p = handoffPaths(cwd)
  fs.mkdirSync(p.dir, { recursive: true })
  const docBytes = Buffer.from('# Existing handoff\nDo not rewrite this file.\n')
  fs.writeFileSync(p.doc, docBytes)
  writeMarker(p, {
    schema: 'handoff/v1', createdAt: new Date().toISOString(), doc: p.doc, nonce: 'live',
    title: 'exoloop S-L2', generation: 1,
  })
  const markerBytes = fs.readFileSync(p.pending)
  const out = run(['--respawn', cwd], { cwd: repo('ho-caller-'), home: registryHome, env: { HANDOFF_SPAWN: 'none' } })
  assert.equal(out.ok, true)
  assert.equal(out.mode, 'none')
  assert.equal(out.generation, 1)
  assert.ok(out.title.startsWith('exoloop S-L2'))
  assert.deepEqual(fs.readFileSync(p.doc), docBytes)
  assert.deepEqual(fs.readFileSync(p.pending), markerBytes)
})

test('respawn without a pending marker reports no-pending-marker', () => {
  const cwd = repo(); const out = run(['--respawn', cwd], { cwd, home: home(), env: { HANDOFF_SPAWN: 'none' } })
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'no-pending-marker')
})

test('respawn writes the registry before a failed terminal opener', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only terminal opener')
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' })
  } catch {
    return t.skip('PowerShell is not available')
  }

  const targetCwd = repo('ho-terminal-target-')
  const callerCwd = repo('ho-terminal-caller-')
  const registryHome = home()
  const p = handoffPaths(targetCwd)
  fs.mkdirSync(p.dir, { recursive: true })
  fs.writeFileSync(p.doc, '# Handoff')
  writeMarker(p, {
    schema: 'handoff/v1', createdAt: new Date().toISOString(), doc: p.doc,
    nonce: 'terminal', title: 'panel verdicts', generation: 2,
  })

  const result = await runAsync(['--respawn', targetCwd, '--spawn', 'terminal'], {
    cwd: callerCwd,
    home: registryHome,
    env: { HANDOFF_TERMINAL_EXE: 'C:\\nonexistent\\wt.exe' },
  })
  const out = JSON.parse(result.stdout)

  assert.equal(result.code, 0)
  assert.equal(out.ok, true)
  assert.equal(out.spawn.ok, false)
  assert.equal(out.spawn.mode, 'manual')
  assert.ok(result.firstEntryAt != null)
  assert.ok(result.closedAt - result.firstEntryAt >= 100)
  assert.equal(require('../registry.cjs').listEntries(registryHome).length, 1)
  assert.ok(fs.existsSync(p.pending))
})
