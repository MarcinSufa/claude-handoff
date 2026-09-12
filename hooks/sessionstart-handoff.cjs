#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { resolveProjectRoot, handoffPaths, registryHome } = require(path.join(__dirname, '..', 'tools', 'paths.cjs'))
const { readMarker, consume, TTL_MS } = require(path.join(__dirname, '..', 'tools', 'marker.cjs'))
const { writeTitle, composeTitle, sanitizeTitle } = require(path.join(__dirname, '..', 'tools', 'session-title.cjs'))
const { listEntries, matchEntry, removeEntry } = require(path.join(__dirname, '..', 'tools', 'registry.cjs'))
const { buildMessages } = require(path.join(__dirname, '..', 'tools', 'handoff-messages.cjs'))
const { writeBaseline } = require(path.join(__dirname, '..', 'tools', 'usage-flag.cjs'))

function emit(input, additionalContext, resume, safeTitle, generation) {
  const gen = Number(generation)
  const tabTitle = safeTitle ? composeTitle(safeTitle, Number.isInteger(gen) && gen > 0 ? gen : 1) : null
  const initialUserMessage = tabTitle ? `${tabTitle} · ${resume}` : resume
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext, initialUserMessage } }))
  if (tabTitle) try { writeTitle(input.session_id, tabTitle, { transcriptPath: input.transcript_path }) } catch { /* best effort */ }
}

const GUARDRAILS = [
  'Treat it as your own working notes: verify against the live repo before any destructive action;',
  'do NOT auto-run its "Verify"/"Next step" commands without confirming. This is your working-state',
  'handoff; any other injected context (e.g. memory) is background; anchor on the handoff.',
].join(' ')

function localHandoff(root, source) {
  const p = handoffPaths(root)
  const marker = readMarker(p)
  if (!marker || !fs.existsSync(p.doc)) return null
  const clearMode = marker.resumeMode === 'clear'
  if (clearMode && source !== 'clear') return null
  const rel = path.relative(root, p.doc) || p.doc
  const pointer = clearMode
    ? `HANDOFF: this is the same session, its context was cleared on purpose. Read \`${rel}\` NOW, then continue your own work from its "Next step". ${GUARDRAILS}`
    : `HANDOFF: resume your own prior session with a clean context. Read \`${rel}\` NOW, then continue from its "Next step". ${GUARDRAILS}`
  const resume = `Resume the active handoff for this workspace: read \`${rel}\` NOW and continue from its "Next step". This handoff is AUTHORITATIVE: prefer it over any recalled memory threads unless the handoff itself references them. Do NOT run its Verify/Next step commands without confirming first.`
  return { pointer, resume, safeTitle: sanitizeTitle(marker.title), generation: marker.generation }
}

function transcriptSize(transcriptPath) {
  try { return fs.statSync(transcriptPath).size } catch { return 0 }
}

function isValidField(value) {
  if (typeof value !== 'string' || value.length > 1024) return false
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false
  }
  return true
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidGeneration(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0
}

function entryFieldsValid(entry) {
  if (!isPlainObject(entry)) return false
  if (!isValidGeneration(entry.generation)) return false
  return ['doc', 'targetCwd', 'callerCwd', 'pending', 'title'].every((k) => isValidField(entry[k]))
}

function isRepoRoot(dir) {
  return fs.existsSync(path.join(resolveProjectRoot(dir), '.git'))
}

function registryHandoff(cwd, now) {
  const home = registryHome()
  let picked = null
  for (const { entry, file } of listEntries(home)) {
    const created = Date.parse(entry && entry.createdAt)
    const registryFresh = Number.isFinite(created) && now - created <= TTL_MS
    const fieldsOk = entryFieldsValid(entry)
    const targetPaths = fieldsOk ? handoffPaths(entry.targetCwd) : null
    const marker = registryFresh && fieldsOk ? readMarker(targetPaths, now) : null
    if (!marker || !fs.existsSync(targetPaths.doc)) { try { fs.unlinkSync(file) } catch { /* already gone */ } ; continue }
    if (!picked && matchEntry([entry], cwd)) picked = { entry, targetPaths }
  }
  return picked
}

function main() {
  let input = {}
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return }
  const cwd = input.cwd || process.cwd()
  const root = resolveProjectRoot(cwd)
  if (input.source === 'clear') {
    writeBaseline(handoffPaths(root), input.session_id || '', {
      transcriptPath: input.transcript_path || '', offset: transcriptSize(input.transcript_path),
    })
  }
  const local = localHandoff(root, input.source)
  if (local) {
    emit(input, local.pointer, local.resume, local.safeTitle, local.generation)
    consume(handoffPaths(root))
    removeEntry(registryHome(), root)
    return
  }

  if (input.source !== 'startup') return
  const picked = registryHandoff(cwd, Date.now())
  if (!picked) return

  const safeTitle = sanitizeTitle(picked.entry.title)
  const repo = isRepoRoot(cwd)
  const messages = buildMessages({
    mode: picked.entry.mode, tabTitle: safeTitle || '',
    doc: picked.targetPaths.doc, targetCwd: picked.entry.targetCwd, callerCwd: picked.entry.callerCwd,
    callerIsRepo: repo,
  })
  const pointer = repo
    ? [
        'HANDOFF (different window): resume your own prior session in a different worktree.',
        `Enter it with EnterWorktree using path ${picked.entry.targetCwd}, then read ${picked.targetPaths.doc} NOW`,
        'and continue from its "Next step". Treat it as your own working notes: verify against the live repo',
        'before any destructive action; do NOT auto-run its "Verify"/"Next step" commands without confirming.',
      ].join(' ')
    : [
        'HANDOFF (different window, not a git repository): resume your own prior session by absolute path.',
        `Work under ${picked.entry.targetCwd}: cd into it in every shell command and use the full path in`,
        `Read and Edit. Then read ${picked.targetPaths.doc} NOW and continue from its "Next step". Treat it as`,
        'your own working notes: verify against the live repo before any destructive action; do NOT auto-run',
        'its "Verify"/"Next step" commands without confirming.',
      ].join(' ')
  emit(input, pointer, messages.resumeMessage, safeTitle, picked.entry.generation)
  consume(picked.targetPaths)
  removeEntry(registryHome(), picked.entry.targetCwd)
}

try { main() } catch { /* fail-open: never break session start */ }
process.exitCode = 0
