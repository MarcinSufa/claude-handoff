const { test } = require('node:test'); const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
// Keep the durable log and registry out of the real home: capture() appends to <HANDOFF_HOME>/index.jsonl.
const TEST_HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-home-')))
process.env.HOME = TEST_HOME; process.env.USERPROFILE = TEST_HOME; process.env.HANDOFF_HOME = path.join(TEST_HOME, '.claude', 'handoff')
const { handoffPaths } = require('../paths.cjs')
const { readMarker } = require('../marker.cjs')
const { capture } = require('../capture.cjs')

function repo() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-cap-'))) }
const good = { goal: 'G', specifics: [], state: 'S', nextStep: 'N', constraints: [], gotchas: [], openQuestions: [], keepOnFail: [], verify: [] }

test('writes HANDOFF.md + pending marker and returns ok', () => {
  const root = repo(); const p = handoffPaths(root)
  const r = capture(JSON.stringify(good), { root, fromSessionId: 'sid' })
  assert.equal(r.ok, true)
  assert.ok(fs.existsSync(p.doc)); assert.ok(fs.existsSync(p.pending))
  assert.equal(readMarker(p).fromSessionId, 'sid')
})
test('rejects malformed stdin JSON', () => {
  const root = repo()
  assert.equal(capture('{not json', { root }).ok, false)
})
test('rejects empty goal/nextStep', () => {
  const root = repo()
  assert.equal(capture(JSON.stringify({ ...good, nextStep: '' }), { root }).ok, false)
})
test('redacts secrets in the written doc', () => {
  const root = repo(); const p = handoffPaths(root)
  capture(JSON.stringify({ ...good, gotchas: ['db is postgresql://u:SECRETpw@h:5432/d'] }), { root })
  assert.ok(!fs.readFileSync(p.doc, 'utf8').includes('SECRETpw'))
})
test('appends .claude/handoff/ to .gitignore of a git repo when absent', () => {
  const root = repo(); fs.mkdirSync(path.join(root, '.git'))
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ndist')
  capture(JSON.stringify(good), { root })
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'node_modules/\ndist\n.claude/handoff/\n')
})
test('creates .gitignore when the git repo has none', () => {
  const root = repo(); fs.mkdirSync(path.join(root, '.git'))
  capture(JSON.stringify(good), { root })
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '.claude/handoff/\n')
})
test('leaves .gitignore alone when the line is already present', () => {
  const root = repo(); fs.mkdirSync(path.join(root, '.git'))
  fs.writeFileSync(path.join(root, '.gitignore'), '# mine\n.claude/handoff/\n*.log\n')
  capture(JSON.stringify(good), { root }); capture(JSON.stringify(good), { root })
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '# mine\n.claude/handoff/\n*.log\n')
})
test('does not touch .gitignore outside a git repo', () => {
  const root = repo()
  capture(JSON.stringify(good), { root })
  assert.ok(!fs.existsSync(path.join(root, '.gitignore')))
})
test('treats an existing .claude/ or .claude/handoff line as already covering', () => {
  for (const line of ['.claude/', '.claude', '.claude/handoff', '.claude/handoff/']) {
    const root = repo(); fs.mkdirSync(path.join(root, '.git'))
    fs.writeFileSync(path.join(root, '.gitignore'), `${line}\n*.log\n`)
    capture(JSON.stringify(good), { root })
    assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), `${line}\n*.log\n`, line)
  }
})
test('a .gitignore that is a directory does not break capture after the doc and marker are written', () => {
  const root = repo(); const p = handoffPaths(root); fs.mkdirSync(path.join(root, '.git'))
  fs.mkdirSync(path.join(root, '.gitignore'))
  const r = capture(JSON.stringify(good), { root })
  assert.equal(r.ok, true)
  assert.equal(r.gitignore, 'skipped')
  assert.ok(fs.existsSync(p.doc)); assert.ok(fs.existsSync(p.pending))
})

test('the durable log goes under HANDOFF_HOME, never the real ~/.claude/handoffs', () => {
  const root = repo()
  capture(JSON.stringify({ ...good, goal: 'log isolation check' }), { root })
  const log = path.join(process.env.HANDOFF_HOME, 'index.jsonl')
  assert.equal(require('../memory.cjs').logPath(), log)
  const last = fs.readFileSync(log, 'utf8').trim().split('\n').pop()
  assert.equal(JSON.parse(last).goal, 'log isolation check')
  assert.equal(fs.existsSync(path.join(TEST_HOME, '.claude', 'handoffs')), false)
})
