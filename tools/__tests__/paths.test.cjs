const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolveProjectRoot, handoffPaths, autoHandoffPaths } = require('../paths.cjs')

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ho-paths-'))
  fs.mkdirSync(path.join(root, '.git'))
  fs.mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true })
  return fs.realpathSync(root)
}

test('resolveProjectRoot walks up to the nearest .git', () => {
  const root = tmpRepo()
  assert.equal(fs.realpathSync(resolveProjectRoot(path.join(root, 'sub', 'deep'))), root)
})

test('SEAM: capture cwd and hook input.cwd resolve to the SAME handoff doc', () => {
  const root = tmpRepo()
  const captureSide = handoffPaths(resolveProjectRoot(path.join(root, 'sub')))
  const hookSide = handoffPaths(resolveProjectRoot(path.join(root, 'sub', 'deep')))
  assert.equal(captureSide.doc, hookSide.doc)
  assert.equal(captureSide.pending, hookSide.pending)
})

test('CLAUDE_PROJECT_DIR has NO effect (it is empty/ignored in the target env)', () => {
  const root = tmpRepo()
  process.env.CLAUDE_PROJECT_DIR = path.join(os.tmpdir(), 'somewhere-else')
  try {
    assert.equal(fs.realpathSync(resolveProjectRoot(root)), root)
  } finally { delete process.env.CLAUDE_PROJECT_DIR }
})

test('autoHandoffPaths scopes the snapshot under auto/<sanitized session id> and keeps the repo gitignore', () => {
  const root = tmpRepo()
  const p = autoHandoffPaths(root, 'sX')
  assert.equal(p.root, root)
  assert.equal(p.dir, path.join(root, '.claude', 'handoff', 'auto', 'sX'))
  assert.equal(p.doc, path.join(p.dir, 'HANDOFF.md'))
  assert.equal(p.pending, path.join(p.dir, 'handoff.pending.json'))
  assert.equal(p.consumed, path.join(p.dir, 'handoff.consumed.json'))
  assert.equal(p.gitignore, handoffPaths(root).gitignore)
  assert.equal(path.basename(autoHandoffPaths(root, 'unsafe/sess:id').dir), 'unsafe_sess_id')
  assert.equal(path.basename(autoHandoffPaths(root, '').dir), 'unknown')
})

test('non-git dir falls back to the start dir itself', () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-nogit-')))
  assert.equal(fs.realpathSync(resolveProjectRoot(d)), d)
})
