// Cross-environment spawn adapter (spec §3.1): focus project window → extension URI → CLI new-terminal → universal fallback.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function buildUri(scheme, prompt) {
  return `${scheme || 'cursor'}://anthropic.claude-code/open?prompt=${encodeURIComponent(prompt)}`
}

// A session launched by the Cursor extension inherits ELECTRON_RUN_AS_NODE=1; with it Cursor.exe boots as plain node
// and rejects --open-url, so every URI/editor launch below runs with that variable removed.
function childEnv(env) {
  const out = { ...(env || process.env) }
  delete out.ELECTRON_RUN_AS_NODE
  return out
}

function editorExe() {
  if (process.env.HANDOFF_EDITOR_EXE) return process.env.HANDOFF_EDITOR_EXE
  if (process.platform === 'win32') {
    const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe')
    return fs.existsSync(exe) ? exe : 'cursor'
  }
  return 'cursor'
}

// platform openers: return true on success, THROW on failure (so the cascade can fall through)
function uriOpener(uri) {
  const env = childEnv()
  if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Start-Process '${uri.replace(/'/g, "''")}'`], { env })
  else if (process.platform === 'darwin') execFileSync('open', [uri], { env })
  else execFileSync('xdg-open', [uri], { env })
  return true
}
// The URI lands in the LAST ACTIVE editor window; re-opening the project folder makes that window active first.
function focusOpener(cwd) {
  const env = childEnv()
  if (process.platform === 'darwin') execFileSync('open', ['-a', 'Cursor', cwd], { env })
  else execFileSync(editorExe(), [cwd], { env, stdio: 'ignore', timeout: 10000 })
  return true
}
function terminalOpener(cwd) { // launch a NEW terminal running `claude` in cwd (CLI path)
  const dir = cwd || process.cwd()
  const env = childEnv()
  if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Start-Process wt -ArgumentList '-d',"${dir.replace(/"/g, '`"')}",'claude'`], { env })
  else if (process.platform === 'darwin') execFileSync('osascript', ['-e', `tell app "Terminal" to do script "cd \\"${dir}\\" && claude"`], { env })
  else execFileSync('x-terminal-emulator', ['-e', `bash -lc 'cd "${dir}" && claude'`], { env })
  return true
}

function sleepMs(ms) { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

const FALLBACK = (doc) => `Handoff saved${doc ? ` at ${doc}` : ''}. Start a fresh \`claude\` in this directory (it will auto-resume), then close this session.`

// Cascade: focus+uri (extension) → terminal (CLI) → universal fallback. mode forces a single path.
function spawn({ scheme, prompt, cwd, doc, mode, openers, focusDelayMs }) {
  const o = openers || { focus: (c) => focusOpener(c), uri: (s, p) => uriOpener(buildUri(s, p)), terminal: (c) => terminalOpener(c) }
  const m = mode || process.env.HANDOFF_SPAWN || 'auto'
  const dir = cwd || process.cwd()
  const delay = focusDelayMs == null ? (openers ? 0 : 3000) : focusDelayMs
  const tryUri = () => {
    if (o.focus) { try { o.focus(dir); sleepMs(delay) } catch { /* focus is optional */ } }
    o.uri(scheme || process.env.HANDOFF_URI_SCHEME || 'cursor', prompt)
    return { ok: true, mode: 'uri' }
  }
  const tryTerm = () => { o.terminal(dir); return { ok: true, mode: 'terminal' } }
  const fb = () => ({ ok: false, mode: 'manual', message: FALLBACK(doc) })
  if (m === 'none') return fb()
  if (m === 'uri') { try { return tryUri() } catch { return fb() } }
  if (m === 'terminal') { try { return tryTerm() } catch { return fb() } }
  try { return tryUri() } catch { /* fall through */ }
  try { return tryTerm() } catch { /* fall through */ }
  return fb()
}

const spawnTab = spawn // back-compat alias
module.exports = { buildUri, childEnv, spawn, spawnTab, uriOpener, focusOpener, terminalOpener }
