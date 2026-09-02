#!/usr/bin/env node
// tools/handoff.cjs reads the 9-field JSON from stdin (+ optional `title`). Captures, then opens a fresh session (CLI or extension).
const fs = require('node:fs')
const { capture } = require('./capture.cjs')
const { spawn } = require('./spawn-tab.cjs')
const { sessionNamePrefix, composeTitle } = require('./session-title.cjs')

const stdin = fs.readFileSync(0, 'utf8')
const cap = capture(stdin, { fromSessionId: process.env.CLAUDE_CODE_SESSION_ID || null })
if (!cap.ok) { process.stdout.write(JSON.stringify({ ok: false, stage: 'capture', reason: cap.reason })); process.exit(0) }

const tabTitle = composeTitle(cap.title, cap.generation)
const resumeMessage = `Resume handoff for project ${cap.projectRoot}: read ${cap.doc} and continue from its "Next step". Treat it as your own prior notes; verify before destructive actions. If your workspace is a different folder, reply "wrong window" and stop.`
// The tab is titled after its first prompt, so the title leads the backstop prompt (used when SessionStart inject is unavailable).
const prompt = `${tabTitle} · ${resumeMessage}`
const spawnResult = spawn({ scheme: process.env.HANDOFF_URI_SCHEME, prompt, cwd: cap.projectRoot, doc: cap.doc })
process.stdout.write(JSON.stringify({
  ok: true, doc: cap.doc, spawn: spawnResult, title: tabTitle, generation: cap.generation,
  sessionNamePrefix: sessionNamePrefix(cap.projectRoot), resumeMessage,
  closeOld: 'Handoff is ready in the fresh session. Close THIS session to finish the handoff.',
}))
process.exitCode = 0
