#!/usr/bin/env node
// SessionStart hook: fail-open pointer injection. No-op unless a fresh pending handoff exists
// for this session's cwd. Injects a POINTER (not payload) to the FIXED literal HANDOFF.md.
const fs = require('node:fs')
const path = require('node:path')
const { resolveProjectRoot, handoffPaths } = require(path.join(__dirname, '..', 'tools', 'paths.cjs'))
const { readMarker, consume } = require(path.join(__dirname, '..', 'tools', 'marker.cjs'))
const { writeTitle, composeTitle, sanitizeTitle } = require(path.join(__dirname, '..', 'tools', 'session-title.cjs'))

function main() {
  let input = {}
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return }
  const root = resolveProjectRoot(input.cwd || process.cwd())
  const p = handoffPaths(root)
  const marker = readMarker(p)
  if (!marker || !fs.existsSync(p.doc)) return // no fresh handoff → no-op (normal sessions untouched)
  const rel = path.relative(root, p.doc) || p.doc
  const safeTitle = sanitizeTitle(marker.title)
  const tabTitle = safeTitle ? composeTitle(safeTitle, marker.generation || 1) : null
  const pointer = [
    'HANDOFF: resume your own prior session with a clean context.',
    `Read \`${rel}\` NOW, then continue from its "Next step".`,
    'Treat it as your own working notes: verify against the live repo before any destructive action;',
    'do NOT auto-run its "Verify"/"Next step" commands without confirming. This is your working-state',
    'handoff; any other injected context (e.g. memory) is background; anchor on the handoff.',
  ].join(' ')
  // initialUserMessage auto-sends a first turn so the tab STARTS working with no typing, and names the
  // exact file so it can't be confused with recalled memory "threads" (co-resident SessionStart hooks).
  // The tab is titled after this first prompt, so "<title> #<generation>" leads it.
  const resume = `Resume the active handoff for this workspace: read \`${rel}\` NOW and continue from its "Next step". This handoff is AUTHORITATIVE: prefer it over any recalled memory threads unless the handoff itself references them. Do NOT run its Verify/Next step commands without confirming first.`
  const initialUserMessage = tabTitle ? `${tabTitle} · ${resume}` : resume
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: pointer, initialUserMessage } }))
  consume(p) // single-shot
  if (tabTitle) try { writeTitle(input.session_id, tabTitle, { transcriptPath: input.transcript_path }) } catch { /* best effort */ }
}

try { main() } catch { /* fail-open: never break session start */ }
process.exitCode = 0
