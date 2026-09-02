const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolveProjectRoot, handoffPaths } = require('../paths.cjs')

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

test('non-git dir falls back to the start dir itself', () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-nogit-')))
  assert.equal(fs.realpathSync(resolveProjectRoot(d)), d)
})
