const { test } = require('node:test'); const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { handoffPaths } = require('../paths.cjs')
const { readMarker, writeMarker } = require('../marker.cjs')
const { capture } = require('../capture.cjs')
const { toMarkdown, parseDoc } = require('../handoff-format.cjs')
const HOOK = path.join(__dirname, '..', '..', 'hooks', 'sessionstart-handoff.cjs')

function repo() { const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-gen-'))); fs.mkdirSync(path.join(r, '.git')); return r }
const good = { goal: 'Ship the panel verdicts slice with conduct', specifics: [], state: 'S', nextStep: 'N', constraints: [], gotchas: [], openQuestions: [], keepOnFail: [], verify: [] }

test('first handoff: generation 1, title defaults to the first words of the goal', () => {
  const root = repo(); const p = handoffPaths(root)
  const r = capture(JSON.stringify(good), { root })
  assert.equal(r.generation, 1)
  assert.equal(r.title, 'Ship the panel verdicts')
  const m = readMarker(p)
  assert.equal(m.generation, 1); assert.equal(m.title, 'Ship the panel verdicts')
  assert.equal(parseDoc(fs.readFileSync(p.doc, 'utf8')).meta.generation, '1')
})
test('explicit title wins and the next handoff bumps the generation, keeping the title', () => {
  const root = repo(); const p = handoffPaths(root)
  capture(JSON.stringify({ ...good, title: 'panel verdicts' }), { root })
  const r = capture(JSON.stringify(good), { root })
  assert.equal(r.generation, 2); assert.equal(r.title, 'panel verdicts')
  assert.equal(readMarker(p).generation, 2)
})
test('frontmatter round-trips title and generation', () => {
  const parsed = parseDoc(toMarkdown(good, { title: 'x y', generation: 4 }))
  assert.equal(parsed.meta.title, 'x y'); assert.equal(parsed.meta.generation, '4')
})
test('SessionStart hook leads the first message with "<title> #<gen>" and writes the sidecar', () => {
  const root = repo(); const p = handoffPaths(root)
  const projects = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-gen-proj-')))
  fs.mkdirSync(path.join(projects, 'c--r')) // the transcript file itself does not exist yet at SessionStart
  fs.mkdirSync(p.dir, { recursive: true }); fs.writeFileSync(p.doc, '# Handoff')
  writeMarker(p, { schema: 'handoff/v1', createdAt: new Date().toISOString(), doc: p.doc, nonce: 'n', title: 'panel verdicts', generation: 2 })
  const out = JSON.parse(execFileSync('node', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: root, session_id: 'new-sess', transcript_path: path.join(projects, 'c--r', 'new-sess.jsonl') }),
    encoding: 'utf8', env: { ...process.env, HANDOFF_PROJECTS_DIR: projects },
  }))
  assert.ok(out.hookSpecificOutput.initialUserMessage.startsWith('panel verdicts #2'))
  const side = path.join(projects, 'c--r', 'new-sess', 'custom-title.json')
  assert.equal(JSON.parse(fs.readFileSync(side, 'utf8')).customTitle, 'panel verdicts #2')
})
