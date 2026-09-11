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
function terminalExe(deps) {
  if (deps.env.HANDOFF_TERMINAL_EXE) return deps.env.HANDOFF_TERMINAL_EXE
  const candidate = path.join(deps.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe')
  return deps.existsSync(candidate) ? candidate : 'wt.exe'
}

// Start-Process can report success while no terminal ever opens (measured 2026-09-11), so the win32
// path asks for -PassThru and requires a numeric process Id back, throwing otherwise.
function terminalOpener(cwd, deps) {
  const d = deps || { exec: execFileSync, platform: process.platform, env: process.env, existsSync: fs.existsSync }
  const dir = cwd || process.cwd()
  const env = childEnv(d.env)
  if (d.platform === 'win32') {
    const exe = terminalExe(d)
    const script = `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList '-d',"${dir.replace(/"/g, '`"')}",'claude' -PassThru | Select-Object -ExpandProperty Id`
    const out = String(d.exec('powershell', ['-NoProfile', '-Command', script], { env })).replace(/^\ufeff/, '').trim()
    if (!/^\d+$/.test(out)) throw new Error('terminal spawn produced no pid')
    return true
  }
  if (d.platform === 'darwin') d.exec('osascript', ['-e', `tell app "Terminal" to do script "cd \\"${dir}\\" && claude"`], { env })
  else d.exec('x-terminal-emulator', ['-e', `bash -lc 'cd "${dir}" && claude'`], { env })
  return true
}
function openWindowOpener(cwd) {
  const env = childEnv()
  execFileSync(editorExe(), ['-n', cwd], { env, stdio: 'ignore', timeout: 10000 })
  return true
}
// Polls the win32 foreground window title for the target folder's basename; no other platform exposes this cheaply.
function waitForegroundOpener(cwd) {
  if (process.platform !== 'win32') return true
  const target = path.basename(cwd).replace(/'/g, "''")
  const script = [
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices; using System.Text;',
    'public class HandoffWin32 {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);',
    '}',
    '"@',
    `$target = '${target}'`,
    '$deadline = (Get-Date).AddSeconds(15)',
    'while ((Get-Date) -lt $deadline) {',
    '  $sb = New-Object System.Text.StringBuilder 256',
    '  [HandoffWin32]::GetWindowText([HandoffWin32]::GetForegroundWindow(), $sb, $sb.Capacity) | Out-Null',
    '  if ($sb.ToString() -like "*$target*") { exit 0 }',
    '  Start-Sleep -Milliseconds 250',
    '}',
    'exit 1',
  ].join('\n')
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', script], { env: childEnv(), timeout: 16000 })
    return true
  } catch {
    return false
  }
}

function sleepMs(ms) { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

const FALLBACK = (doc) => `Handoff saved${doc ? ` at ${doc}` : ''}. Start a fresh \`claude\` in this directory (it will auto-resume), then close this session.`

// Legacy env/field values collapse onto uri-target so old HANDOFF_SPAWN settings keep working.
function resolveMode(mode) {
  const raw = mode || process.env.HANDOFF_SPAWN || 'same-window'
  return raw === 'auto' || raw === 'uri' ? 'uri-target' : raw
}

function spawn({ scheme, prompt, cwd, doc, mode, openers, focusDelayMs }) {
  const o = openers || {
    focus: (c) => focusOpener(c),
    uri: (s, p) => uriOpener(buildUri(s, p)),
    terminal: (c) => terminalOpener(c),
    openWindow: (c) => openWindowOpener(c),
    waitForeground: (c) => waitForegroundOpener(c),
  }
  const m = resolveMode(mode)
  const dir = cwd || process.cwd()
  const delay = focusDelayMs == null ? (openers ? 0 : 3000) : focusDelayMs
  const fireUri = () => { o.uri(scheme || process.env.HANDOFF_URI_SCHEME || 'cursor', prompt) }
  const tryTerm = () => { o.terminal(dir); return { ok: true, mode: 'terminal' } }
  const fb = () => ({ ok: false, mode: 'manual', message: FALLBACK(doc) })

  if (m === 'none') return fb()

  if (m === 'same-window') {
    try { fireUri(); return { ok: true, mode: 'same-window' } } catch { /* fall through */ }
    try { return tryTerm() } catch { /* fall through */ }
    return fb()
  }

  if (m === 'uri-target') {
    try {
      if (o.focus) { try { o.focus(dir); sleepMs(delay) } catch { /* focus is optional */ } }
      fireUri()
      return { ok: true, mode: 'uri-target' }
    } catch { /* fall through */ }
    try { return tryTerm() } catch { /* fall through */ }
    return fb()
  }

  if (m === 'window') {
    try {
      if (o.openWindow) o.openWindow(dir)
      let focused = false
      if (o.waitForeground) { try { focused = !!o.waitForeground(dir) } catch { focused = false } }
      fireUri()
      return { ok: true, mode: 'window', focused }
    } catch {
      return fb()
    }
  }

  if (m === 'terminal') { try { return tryTerm() } catch { return fb() } }

  return fb()
}

const spawnTab = spawn // back-compat alias
module.exports = {
  buildUri, childEnv, spawn, spawnTab, resolveMode,
  uriOpener, focusOpener, terminalOpener, openWindowOpener, waitForegroundOpener,
}
