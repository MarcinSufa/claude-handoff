const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { herdrLaunch, agentName } = require('../herdr.cjs')
const { spawn, resolveMode } = require('../spawn-tab.cjs')

// A scripted herdr: each handler gets the argv and returns stdout, or throws an error shaped like
// execFileSync's (stderr carries herdr's JSON error). Nothing here ever reaches a real herdr.
function fakeHerdr(handlers) {
  const calls = []
  const exec = (bin, argv) => {
    calls.push([bin, ...argv])
    const key = argv[0] === 'tab' ? 'tab' : argv[1]
    const h = handlers[key]
    if (!h) throw new Error(`unexpected herdr call ${argv.join(' ')}`)
    return h(argv)
  }
  return { calls, exec }
}
function herdrError(code) {
  const e = new Error('Command failed: herdr')
  e.stderr = JSON.stringify({ error: { code, message: code } })
  e.stdout = ''
  return e
}
const TAB = () => JSON.stringify({ result: { root_pane: { pane_id: 'w5:p2', tab_id: 'w5:t2' } } })
const GET = (status) => () => JSON.stringify({ result: { agent: { agent_status: status } } })

test('herdr launch: tab create, agent start with the prompt after --, then confirm working', () => {
  const f = fakeHerdr({ tab: TAB, start: () => '{}', wait: () => '{}', get: GET('working') })
  const r = herdrLaunch({ cwd: '/proj', label: 'panel verdicts #3', args: ['resume prompt'], confirm: true,
    deps: { exec: f.exec, env: { HERDR_BIN_PATH: '/opt/herdr' }, now: () => 1700000000000 } })
  assert.equal(r.ok, true)
  assert.equal(r.paneId, 'w5:p2')
  assert.equal(r.status, 'working')
  assert.equal(r.trustAccepted, false)
  assert.deepEqual(f.calls[0], ['/opt/herdr', 'tab', 'create', '--cwd', '/proj', '--label', 'panel verdicts #3'])
  const start = f.calls[1]
  assert.deepEqual(start.slice(1, 7), ['agent', 'start', r.agent, '--kind', 'claude', '--pane'])
  assert.equal(start[7], 'w5:p2')
  assert.deepEqual(start.slice(start.indexOf('--') + 1), ['resume prompt'])
  assert.deepEqual(f.calls.map((c) => c[2]), ['create', 'start', 'wait', 'get'])
  assert.match(r.agent, /^panel-verdicts-3-[a-z0-9]{1,4}$/)
})

test('herdr launch accepts the folder trust dialog with down enter when start reports agent_not_ready', () => {
  const f = fakeHerdr({
    tab: TAB,
    start: () => { throw herdrError('agent_not_ready') },
    read: () => 'Do you trust the files in this folder?\n> No, exit\n  Yes, I trust this folder',
    'send-keys': () => '{}', wait: () => '{}', get: GET('working'),
  })
  const r = herdrLaunch({ cwd: '/new', label: 'x', args: ['p'], confirm: true, deps: { exec: f.exec, env: {} } })
  assert.equal(r.ok, true)
  assert.equal(r.trustAccepted, true)
  const keys = f.calls.find((c) => c[2] === 'send-keys')
  assert.deepEqual(keys.slice(3), [r.agent, 'down', 'enter'])
})

test('agent_not_ready without a trust dialog on screen sends no keys and is not launched', () => {
  const f = fakeHerdr({ tab: TAB, start: () => { throw herdrError('agent_not_ready') }, read: () => 'some other prompt' })
  const r = herdrLaunch({ cwd: '/p', label: 'x', confirm: true, deps: { exec: f.exec, env: {} } })
  assert.equal(r.ok, false)
  assert.match(r.error, /no trust dialog/)
  assert.equal(f.calls.some((c) => c[2] === 'send-keys'), false)
})

test('a start failure other than agent_not_ready is reported with herdr error code, not thrown', () => {
  const f = fakeHerdr({ tab: TAB, start: () => { throw herdrError('pane_not_found') } })
  const r = herdrLaunch({ cwd: '/p', label: 'x', confirm: true, deps: { exec: f.exec, env: {} } })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'pane_not_found')
})

test('a session that is blocked after start is not launched', () => {
  const f = fakeHerdr({ tab: TAB, start: () => '{}', wait: () => { throw herdrError('timeout') }, get: GET('blocked') })
  const r = herdrLaunch({ cwd: '/p', label: 'x', confirm: true, deps: { exec: f.exec, env: {} } })
  assert.equal(r.ok, false)
  assert.equal(r.status, 'blocked')
})

test('no tab (herdr missing or no pane id) throws so the caller can fall back', () => {
  assert.throws(() => herdrLaunch({ cwd: '/p', label: 'x', deps: { exec: () => { throw new Error('ENOENT') }, env: {} } }))
  assert.throws(() => herdrLaunch({ cwd: '/p', label: 'x', deps: { exec: () => '{"result":{}}', env: {} } }), /no root pane/)
})

test('without confirm the launch is ok once start returns, with no wait or get', () => {
  const f = fakeHerdr({ tab: TAB, start: () => '{}' })
  const r = herdrLaunch({ cwd: '/p', label: 'x', confirm: false, deps: { exec: f.exec, env: {} } })
  assert.equal(r.ok, true)
  assert.deepEqual(f.calls.map((c) => c[2]), ['create', 'start'])
})

test('agentName keeps [a-z0-9-] and falls back to handoff', () => {
  assert.match(agentName('Panel Verdicts #3', 1700000000000), /^panel-verdicts-3-[a-z0-9]+$/)
  assert.match(agentName('', 1), /^handoff-1$/)
})

test('HERDR_ENV=1 makes herdr the default mode; HANDOFF_SPAWN and the spawn field still win', () => {
  assert.equal(resolveMode(undefined, { HERDR_ENV: '1' }), 'herdr')
  assert.equal(resolveMode(undefined, {}), 'same-window')
  assert.equal(resolveMode(undefined, { HERDR_ENV: '1', HANDOFF_SPAWN: 'none' }), 'none')
  assert.equal(resolveMode('terminal', { HERDR_ENV: '1' }), 'terminal')
})

test('spawn herdr mode: launched, stuck, and no-tab outcomes', () => {
  const env = { HERDR_ENV: '1' }
  const seen = []
  const ok = spawn({ prompt: 'p', cwd: '/proj', title: 'topic #2', env, openers: {
    herdr: (dir, prompt, label) => { seen.push([dir, prompt, label]); return { ok: true, agent: 'topic-2-ab', paneId: 'w1:p1', status: 'working' } },
  } })
  assert.deepEqual(ok, { ok: true, mode: 'herdr', agent: 'topic-2-ab', paneId: 'w1:p1', status: 'working', trustAccepted: false })
  assert.deepEqual(seen, [['/proj', 'p', 'topic #2']])

  const stuck = spawn({ prompt: 'p', cwd: '/proj', doc: '/proj/.claude/handoff/HANDOFF.md', env, openers: {
    herdr: () => ({ ok: false, agent: 'a-1', status: 'blocked', error: 'agent status blocked' }),
    terminal: () => { throw new Error('must not open a second session') },
  } })
  assert.equal(stuck.ok, false)
  assert.equal(stuck.mode, 'herdr')
  assert.match(stuck.message, /herdr agent read a-1/)
  assert.match(stuck.message, /\/proj\/\.claude\/handoff\/HANDOFF\.md/)

  const none = spawn({ prompt: 'p', cwd: '/proj', env, openers: { herdr: () => { throw new Error('no herdr') } } })
  assert.equal(none.ok, false)
  assert.equal(none.mode, 'manual')
})

test('inside herdr the terminal fallback is a herdr tab first, a desktop terminal only when no tab can be made', () => {
  const calls = []
  const viaHerdr = spawn({ mode: 'terminal', cwd: '/proj', env: { HERDR_ENV: '1' }, openers: {
    herdr: () => { calls.push('herdr'); return { ok: true, agent: 'a' } },
    terminal: () => { calls.push('terminal'); return true },
  } })
  assert.equal(viaHerdr.mode, 'herdr')
  assert.deepEqual(calls, ['herdr'])

  const fallback = spawn({ mode: 'terminal', cwd: '/proj', env: { HERDR_ENV: '1' }, openers: {
    herdr: () => { calls.push('herdr'); throw new Error('no server') },
    terminal: () => { calls.push('terminal'); return true },
  } })
  assert.equal(fallback.mode, 'terminal')

  calls.length = 0
  spawn({ mode: 'terminal', cwd: '/proj', env: {}, openers: {
    herdr: () => { calls.push('herdr'); return { ok: true } },
    terminal: () => { calls.push('terminal'); return true },
  } })
  assert.deepEqual(calls, ['terminal'])
})

// End to end through handoff.cjs with a fake herdr binary (HERDR_BIN_PATH), so the default mode,
// spawn cwd, prompt and launched flag are checked without opening a real tab.
test('handoff.cjs inside herdr opens a herdr tab in the target and reports launched', (t) => {
  if (process.platform === 'win32') return t.skip('fake herdr is a POSIX script')
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-herdr-')))
  const target = path.join(base, 'proj'); fs.mkdirSync(path.join(target, '.git'), { recursive: true })
  const log = path.join(base, 'calls.jsonl')
  const fake = path.join(base, 'herdr')
  fs.writeFileSync(fake, [
    '#!/usr/bin/env node',
    'const fs = require("node:fs"); const a = process.argv.slice(2)',
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + "\\n")`,
    'if (a[0] === "tab") process.stdout.write(JSON.stringify({ result: { root_pane: { pane_id: "w9:p1", tab_id: "w9:t1" } } }))',
    'else if (a[1] === "get") process.stdout.write(JSON.stringify({ result: { agent: { agent_status: "working" } } }))',
    'else process.stdout.write("{}")',
  ].join('\n'))
  fs.chmodSync(fake, 0o755)
  const home = path.join(base, 'home')
  const input = { title: 'herdr e2e', goal: 'Check herdr spawn', specifics: [], state: 'S', nextStep: 'Run tests',
    constraints: [], gotchas: [], openQuestions: [], keepOnFail: [], verify: [] }
  const env = { ...process.env, HERDR_ENV: '1', HERDR_BIN_PATH: fake, HOME: home, HANDOFF_HOME: path.join(home, '.claude', 'handoff') }
  delete env.HANDOFF_SPAWN
  const out = JSON.parse(execFileSync('node', [path.join(__dirname, '..', 'handoff.cjs')], { cwd: target, env, input: JSON.stringify(input), encoding: 'utf8' }))
  assert.equal(out.mode, 'herdr')
  assert.equal(out.launched, true)
  assert.equal(out.spawn.mode, 'herdr')
  assert.equal(out.spawnCwd, target)
  assert.match(out.closeOld, /ready/)
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(calls[0], ['tab', 'create', '--cwd', target, '--label', 'herdr e2e #1'])
  const start = calls[1]
  assert.equal(start[1], 'start')
  const prompt = start[start.indexOf('--') + 1]
  assert.ok(prompt.startsWith('herdr e2e #1 · Resume handoff for project '))
  assert.ok(prompt.includes(path.join(target, '.claude', 'handoff', 'HANDOFF.md')))
})

test('rotate cli host inside herdr opens a herdr tab with the rotation argv instead of a foreground claude', () => {
  const { rotate } = require('../rotate.cjs')
  const nonce = '0049672fbb20aaaaaaaaaaaaaaaaaaaa'
  const f = fakeHerdr({ tab: TAB, start: () => '{}' })
  const r = rotate({ host: 'cli', cwd: '/proj', run_dir: '/run', nonce, settings_path: '/proj/.claude/settings.local.json' },
    { platform: 'linux', env: { HERDR_ENV: '1', CLAUDE_CODE_SESSION_ID: 'old' }, existsSync: () => false, exec: f.exec })
  assert.deepEqual(r, { ok: true, mode: 'herdr', pid: null, error: null })
  assert.equal(f.calls.some((c) => c[0] === 'claude'), false)
  const start = f.calls[1]
  assert.deepEqual(start.slice(start.indexOf('--') + 1),
    [`ctx-rotate:${nonce}`, '--add-dir', '/run', '--permission-mode', 'acceptEdits', '--settings', '/proj/.claude/settings.local.json'])

  const down = rotate({ host: 'cli', cwd: '/proj', run_dir: '/run', nonce, settings_path: null },
    { platform: 'linux', env: { HERDR_ENV: '1' }, existsSync: () => false, exec: () => { throw new Error('ENOENT') } })
  assert.deepEqual(down, { ok: false, mode: 'herdr', pid: null, error: 'halt:launch_failed herdr_unavailable' })

  const stuck = fakeHerdr({ tab: TAB, start: () => { throw herdrError('pane_not_found') } })
  const notStarted = rotate({ host: 'cli', cwd: '/proj', run_dir: '/run', nonce, settings_path: null },
    { platform: 'linux', env: { HERDR_ENV: '1' }, existsSync: () => false, exec: stuck.exec })
  assert.equal(notStarted.error, 'halt:launch_failed herdr_not_started')
})
