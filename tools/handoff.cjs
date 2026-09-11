#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { capture } = require('./capture.cjs')
const { spawn, resolveMode } = require('./spawn-tab.cjs')
const { sessionNamePrefix, composeTitle } = require('./session-title.cjs')
const { handoffPaths, registryHome } = require('./paths.cjs')
const { readMarker } = require('./marker.cjs')
const { writeEntry } = require('./registry.cjs')
const { buildRegistryEntry } = require('./handoff-registry-entry.cjs')
const { buildMessages } = require('./handoff-messages.cjs')

function emit(result) {
  process.stdout.write(JSON.stringify(result))
  process.exitCode = 0
}

function writeRegistryEntry({ mode, targetCwd, callerCwd, doc, pending, title, generation }) {
  if (mode === 'none') return
  writeEntry(registryHome(), buildRegistryEntry({ mode, targetCwd, callerCwd, doc, pending, title, generation }))
}

function dispatch({ targetCwd, callerCwd, doc, pending, title, generation, spawnField }) {
  const mode = resolveMode(spawnField)
  const tabTitle = composeTitle(title, generation)
  const messages = buildMessages({ mode, tabTitle, doc, targetCwd, callerCwd })
  const spawnCwd = mode === 'same-window' ? callerCwd : targetCwd
  writeRegistryEntry({ mode, targetCwd, callerCwd, doc, pending, title, generation })
  const spawnResult = spawn({ scheme: process.env.HANDOFF_URI_SCHEME, prompt: messages.prompt, cwd: spawnCwd, doc, mode })
  return {
    ok: true, mode, spawn: spawnResult, doc, targetCwd, callerCwd, title: tabTitle, generation,
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
    title: marker.title || 'handoff', generation: marker.generation || 1, spawnField,
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

const args = process.argv.slice(2)
const respawnTarget = flagValue(args, '--respawn')
if (respawnTarget) runRespawn(respawnTarget, flagValue(args, '--spawn'), flagValue(args, '--caller-cwd'))
else runCapture()
