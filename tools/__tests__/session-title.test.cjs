const { test } = require('node:test'); const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { writeTitle, sessionNamePrefix, composeTitle } = require('../session-title.cjs')

function projectsDir() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-title-')))
  fs.mkdirSync(path.join(d, 'c--proj'))
  fs.writeFileSync(path.join(d, 'c--proj', 'sess-1.jsonl'), '{"type":"user"}\n')
  return d
}

test('writes the sidecar next to the transcript found by session id', () => {
  const d = projectsDir()
  const r = writeTitle('sess-1', 'panel verdicts #2', { projectsDir: d })
  assert.equal(r.ok, true)
  const side = path.join(d, 'c--proj', 'sess-1', 'custom-title.json')
  assert.deepEqual(JSON.parse(fs.readFileSync(side, 'utf8')), { customTitle: 'panel verdicts #2' })
})
test('unknown session id -> ok:false, nothing written', () => {
  const d = projectsDir()
  assert.equal(writeTitle('nope', 't', { projectsDir: d }).ok, false)
})
test('sessionNamePrefix slugs the project folder the way the harness names sessions', () => {
  assert.equal(sessionNamePrefix('c:\\Users\\x\\Projects\\agent test'), 'agent-test-')
  assert.equal(sessionNamePrefix('/home/x/concretego-web'), 'concretego-web-')
})
test('composeTitle appends the generation number', () => {
  assert.equal(composeTitle('panel verdicts', 3), 'panel verdicts #3')
})
test('sanitizeTitle keeps [A-Za-z0-9 ._#-], collapses whitespace, caps at 60, null when empty', () => {
  const { sanitizeTitle } = require('../session-title.cjs')
  assert.equal(sanitizeTitle('panel \n\t verdicts; <b>#2</b>'), 'panel verdicts b#2b')
  assert.equal(sanitizeTitle('a'.repeat(70)).length, 60)
  assert.equal(sanitizeTitle('<>;'), null)
  assert.equal(sanitizeTitle(null), null)
})
test('writeTitle sanitizes the title before writing the sidecar', () => {
  const d = projectsDir()
  const r = writeTitle('sess-1', 'panel\nverdicts; <b>#2</b>', { projectsDir: d })
  assert.equal(r.ok, true)
  const side = path.join(d, 'c--proj', 'sess-1', 'custom-title.json')
  assert.deepEqual(JSON.parse(fs.readFileSync(side, 'utf8')), { customTitle: 'panel verdicts b#2b' })
})
test('writeTitle refuses a title that sanitizes to nothing', () => {
  const d = projectsDir()
  assert.equal(writeTitle('sess-1', '<>;', { projectsDir: d }).ok, false)
  assert.ok(!fs.existsSync(path.join(d, 'c--proj', 'sess-1', 'custom-title.json')))
})
