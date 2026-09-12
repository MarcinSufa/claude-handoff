#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { resolveProjectRoot, handoffPaths, registryHome } = require(path.join(__dirname, '..', 'tools', 'paths.cjs'))
const { readMarker, consume, TTL_MS } = require(path.join(__dirname, '..', 'tools', 'marker.cjs'))
const { writeTitle, composeTitle, sanitizeTitle } = require(path.join(__dirname, '..', 'tools', 'session-title.cjs'))
const { listEntries, matchEntry, removeEntry } = require(path.join(__dirname, '..', 'tools', 'registry.cjs'))
const { buildMessages } = require(path.join(__dirname, '..', 'tools', 'handoff-messages.cjs'))
const { writeBaseline } = require(path.join(__dirname, '..', 'tools', 'usage-flag.cjs'))
const { readOwnedCompactMarker } = require(path.join(__dirname, '..', 'tools', 'compact-marker.cjs'))

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

// Auto-compact re-seed: the state document outranks the compaction summary, and the session keeps the
// authorization it already had, so the pointer must not send the agent back to the user for a go-ahead.
function compactHandoff(root, sessionId) {
  const owned = readOwnedCompactMarker(root, sessionId)
  if (!owned) return null
  const rel = path.relative(root, owned.paths.doc) || owned.paths.doc
  const pointer = [
    'HANDOFF (auto-compact): the context was just compacted and the summary above is lossy.',
    `\`${rel}\` is AUTHORITATIVE for your working state: read it NOW, then continue from its "Next step"`,
    'within the authorization you already had; do not ask the user for a go-ahead to proceed with Next step.',
    'This is your own saved state, not the manual handoff document .claude/handoff/HANDOFF.md (leave that one alone).',
    'Any other injected context (e.g. memory) is background; anchor on the state document.',
  ].join(' ')
  const resume = `Continue from the saved state: read \`${rel}\` NOW (authoritative over the compaction summary) and proceed from its "Next step" without asking.`
  return { pointer, resume, safeTitle: sanitizeTitle(owned.marker.title), generation: owned.marker.generation, paths: owned.paths }
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
  const source = input.startup_reason != null ? input.startup_reason : input.source
  const sessionId = input.session_id || ''
  if (source === 'clear' || source === 'compact') {
    writeBaseline(handoffPaths(root), sessionId, {
      transcriptPath: input.transcript_path || '', offset: transcriptSize(input.transcript_path),
    })
  }
  if (source === 'compact') {
    const compact = compactHandoff(root, sessionId)
    if (!compact) return
    emit(input, compact.pointer, compact.resume, compact.safeTitle, compact.generation)
    consume(compact.paths)
    return
  }
  const local = localHandoff(root, source)
  if (local) {
    emit(input, local.pointer, local.resume, local.safeTitle, local.generation)
    consume(handoffPaths(root))
    removeEntry(registryHome(), root)
    return
  }

  if (source !== 'startup') return
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
