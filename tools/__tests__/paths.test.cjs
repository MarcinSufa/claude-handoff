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

// The ceiling keeps this independent of the host: a stray .git in /tmp (seen on a Linux server)
// would otherwise turn every temp dir into part of a "repo".
test('non-git dir falls back to the start dir itself', () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-nogit-')))
  const previous = process.env.GIT_CEILING_DIRECTORIES
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(d)
  try {
    assert.equal(fs.realpathSync(resolveProjectRoot(d)), d)
  } finally {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES
    else process.env.GIT_CEILING_DIRECTORIES = previous
  }
})

test('GIT_CEILING_DIRECTORIES stops the walk before an ancestor repo, like git', () => {
  const outer = tmpRepo()
  const inner = path.join(outer, 'a', 'b')
  fs.mkdirSync(inner, { recursive: true })
  const previous = process.env.GIT_CEILING_DIRECTORIES
  try {
    delete process.env.GIT_CEILING_DIRECTORIES
    assert.equal(fs.realpathSync(resolveProjectRoot(inner)), outer)
    process.env.GIT_CEILING_DIRECTORIES = ['relative/ignored', path.join(outer, 'a')].join(path.delimiter)
    assert.equal(fs.realpathSync(resolveProjectRoot(inner)), inner)
    process.env.GIT_CEILING_DIRECTORIES = outer
    assert.equal(fs.realpathSync(resolveProjectRoot(inner)), inner)
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(outer)
    assert.equal(fs.realpathSync(resolveProjectRoot(inner)), outer)
  } finally {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES
    else process.env.GIT_CEILING_DIRECTORIES = previous
  }
})
