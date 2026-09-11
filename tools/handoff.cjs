#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { capture } = require('./capture.cjs')
const { spawn, resolveMode } = require('./spawn-tab.cjs')
const { sessionNamePrefix, composeTitle } = require('./session-title.cjs')
const { handoffPaths, registryHome, resolveProjectRoot } = require('./paths.cjs')
const { readMarker } = require('./marker.cjs')
const { writeEntry } = require('./registry.cjs')
const { buildRegistryEntry } = require('./handoff-registry-entry.cjs')
const { buildMessages } = require('./handoff-messages.cjs')

function emit(result) {
  process.stdout.write(JSON.stringify(result))
  process.exitCode = 0
}

function callerIsRepo(callerCwd) {
  return fs.existsSync(path.join(resolveProjectRoot(callerCwd), '.git'))
}

function toPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function writeRegistryEntry({ mode, targetCwd, callerCwd, doc, pending, title, generation }) {
  if (mode === 'none') return 'skipped'
  try {
    writeEntry(registryHome(), buildRegistryEntry({ mode, targetCwd, callerCwd, doc, pending, title, generation }))
    return 'written'
  } catch {
    return 'failed'
  }
}

function dispatch({ targetCwd, callerCwd, doc, pending, title, generation, spawnField }) {
  const mode = resolveMode(spawnField)
  const tabTitle = composeTitle(title, generation)
  const messages = buildMessages({ mode, tabTitle, doc, targetCwd, callerCwd, callerIsRepo: callerIsRepo(callerCwd) })
  const spawnCwd = mode === 'same-window' ? callerCwd : targetCwd
  const registryStatus = writeRegistryEntry({ mode, targetCwd, callerCwd, doc, pending, title, generation })
  const spawnResult = spawn({
    scheme: process.env.HANDOFF_URI_SCHEME, prompt: messages.prompt, cwd: spawnCwd, doc, mode, targetCwd,
    registryFailed: registryStatus === 'failed',
  })
  return {
    ok: true, mode, registry: registryStatus, spawn: spawnResult, doc, targetCwd, callerCwd, title: tabTitle, generation,
    sessionNamePrefix: sessionNamePrefix(mode === 'same-window' ? callerCwd : targetCwd),
    resumeMessage: messages.resumeMessage,
    closeOld: 'Handoff is ready in the fresh session. Close THIS session to finish the handoff.',
  }
}

function runRespawn(targetArg, spawnField, callerCwdArg) {
  const targetCwd = path.resolve(targetArg)
  const p = handoffPaths(targetCwd)
  const marker = readMarker(p)
  if (!marker || !fs.existsSync(p.doc)) { emit({ ok: false, reason: 'no-pending-marker' }); return }
  const callerCwd = callerCwdArg ? path.resolve(callerCwdArg) : process.cwd()
  emit(dispatch({
    targetCwd, callerCwd, doc: p.doc, pending: p.pending,
    title: marker.title || 'handoff', generation: toPositiveInt(marker.generation, 1), spawnField,
  }))
}

function runCapture() {
  const stdin = fs.readFileSync(0, 'utf8')
  let input = {}
  try { input = JSON.parse(stdin) } catch { input = {} }
  const cap = capture(stdin, { fromSessionId: process.env.CLAUDE_CODE_SESSION_ID || null })
  if (!cap.ok) { emit({ ok: false, stage: 'capture', reason: cap.reason }); return }
  const callerCwd = input.callerCwd ? path.resolve(input.callerCwd) : process.cwd()
  emit(dispatch({
    targetCwd: cap.projectRoot, callerCwd, doc: cap.doc, pending: cap.pending,
    title: cap.title, generation: cap.generation, spawnField: input.spawn,
  }))
}

function flagValue(args, name) {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

function respawnTarget(args) {
  const eq = args.find((a) => a.startsWith('--respawn='))
  if (eq !== undefined) {
    const value = eq.slice('--respawn='.length)
    return value === '' ? null : value
  }
  const i = args.indexOf('--respawn')
  if (i === -1) return undefined
  const next = args[i + 1]
  return next == null || next.startsWith('--') ? null : next
}

const args = process.argv.slice(2)
const target = respawnTarget(args)
if (target === undefined) runCapture()
else if (target === null) emit({ ok: false, reason: 'missing-respawn-target' })
else runRespawn(target, flagValue(args, '--spawn'), flagValue(args, '--caller-cwd'))
