const fs = require('node:fs')
const path = require('node:path')
const { handoffPaths, autoHandoffPaths } = require('./paths.cjs')
const { writeMarker } = require('./marker.cjs')
const { readBaseline } = require('./usage-flag.cjs')
const { redact } = require('./redact.cjs')
const { toMarkdown, parseDoc, FIELDS } = require('./handoff-format.cjs')
const memory = require('./memory.cjs')

function previousMeta(doc) {
  try { return parseDoc(fs.readFileSync(doc, 'utf8')).meta } catch { return {} }
}

function defaultTitle(goal) {
  return goal.trim().split(/\s+/).slice(0, 4).join(' ').replace(/[.,;:!?]+$/, '')
}

const GITIGNORE_LINE = '.claude/handoff/'

const COVERING_LINES = new Set(['.claude', '.claude/', '.claude/handoff', GITIGNORE_LINE])

function ensureGitignore(p) {
  if (!fs.existsSync(path.join(p.root, '.git'))) return 'not-a-repo'
  try {
    let existing = ''
    try { existing = fs.readFileSync(p.gitignore, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
    if (existing.split(/\r?\n/).some((line) => COVERING_LINES.has(line.trim()))) return 'present'
    const separator = existing && !existing.endsWith('\n') ? '\n' : ''
    fs.appendFileSync(p.gitignore, separator + GITIGNORE_LINE + '\n')
    return 'appended'
  } catch {
    return 'skipped'
  }
}

function resumeFields(resumeMode, sessionId, base, tokensAtSave) {
  if (resumeMode === 'clear') return { resumeMode, sessionId }
  if (resumeMode !== 'compact') return {}
  const baseline = readBaseline(base, sessionId)
  return { resumeMode, sessionId, clearEpoch: baseline ? baseline.clearEpoch : 0, tokensAtSave: Number(tokensAtSave) || 0 }
}

function capture(stdin, opts = {}) {
  let fields
  try { fields = JSON.parse(stdin) } catch { return { ok: false, reason: 'invalid-json' } }
  if (!fields || typeof fields.goal !== 'string' || !fields.goal.trim() ||
      typeof fields.nextStep !== 'string' || !fields.nextStep.trim()) {
    return { ok: false, reason: 'missing-goal-or-nextstep' }
  }
  // Normalize + redact every value (scalars → string, list fields → arrays of strings).
  const clean = {}
  for (const f of FIELDS) {
    const v = fields[f]
    clean[f] = Array.isArray(v) ? v.map((x) => redact(String(x))) : redact(String(v == null ? '' : v))
  }
  const base = handoffPaths(opts.root)
  const sessionId = opts.fromSessionId || ''
  const p = opts.resumeMode === 'compact' ? autoHandoffPaths(base.root, sessionId) : base
  const prev = previousMeta(p.doc)
  const generation = (Number(prev.generation) || 0) + 1
  const title = redact(String(fields.title == null ? '' : fields.title)).trim() || prev.title || defaultTitle(clean.goal)
  const createdAt = new Date().toISOString()
  const meta = { createdAt, fromSessionId: opts.fromSessionId || null, projectRoot: p.root, trigger: opts.trigger || 'manual', memoryId: null, title, generation }

  fs.mkdirSync(p.dir, { recursive: true })
  const tmpDoc = p.doc + '.tmp'
  fs.writeFileSync(tmpDoc, redact(toMarkdown(clean, meta)))
  fs.renameSync(tmpDoc, p.doc) // atomic

  const mem = memory.record({ createdAt, projectRoot: p.root, fromSessionId: meta.fromSessionId, goal: clean.goal, title, generation })
  meta.memoryId = mem.memoryId

  // Marker LAST: its presence means "a complete handoff is ready".
  writeMarker(p, {
    schema: 'handoff/v1', createdAt, fromSessionId: meta.fromSessionId, projectRoot: p.root,
    trigger: meta.trigger, doc: p.doc, nonce: createdAt + ':' + (process.hrtime.bigint() % 100000n).toString(),
    title, generation,
    ...resumeFields(opts.resumeMode, sessionId, base, opts.tokensAtSave),
  })
  const gitignore = ensureGitignore(p)
  return { ok: true, doc: p.doc, pending: p.pending, projectRoot: p.root, title, generation, gitignore }
}

module.exports = { capture }
