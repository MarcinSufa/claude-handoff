const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const {
  buildUri, childEnv, launchScript, pidFrom, terminalExe, uriOpener, openWindowOpener, waitForegroundOpener,
} = require('./spawn-tab.cjs')

const ROTATE_PROMPT_RE = /^ctx-rotate:[0-9a-f]{32}$/

function buildPrompt(nonce) {
  const prompt = `ctx-rotate:${nonce}`
  return ROTATE_PROMPT_RE.test(prompt) ? prompt : null
}

function buildCliArgv({ exe, cwd, runDir, nonce, settingsPath }) {
  const argv = [exe, '-w', 'new', '-d', cwd, 'claude', buildPrompt(nonce), '--add-dir', runDir, '--permission-mode', 'acceptEdits']
  if (settingsPath !== null) argv.push('--settings', settingsPath)
  return argv
}

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function validInput(input) {
  return plainObject(input) && (input.host === 'cli' || input.host === 'cursor') &&
    typeof input.cwd === 'string' && input.cwd.length > 0 &&
    typeof input.run_dir === 'string' && input.run_dir.length > 0 &&
    buildPrompt(input.nonce) !== null && (typeof input.settings_path === 'string' || input.settings_path === null)
}

function countCursorWindows(cwd, deps) {
  const d = deps || { platform: process.platform, exec: execFileSync }
  if (d.platform !== 'win32') throw new Error('window enumeration unavailable')
  const title = path.basename(cwd).replace(/'/g, "''")
  const script = `$name='${title}'; @(Get-Process -Name Cursor -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count`
  const output = String(d.exec('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' })).replace(/^\ufeff/, '').trim()
  if (!/^\d+$/.test(output)) throw new Error('invalid window enumeration')
  const count = Number(output)
  if (!Number.isSafeInteger(count)) throw new Error('invalid window enumeration')
  return count
}

function defaults() {
  return {
    platform: process.platform,
    env: process.env,
    exec: execFileSync,
    existsSync: fs.existsSync,
    openWindow: openWindowOpener,
    waitForeground: waitForegroundOpener,
    fireUri: (nonce, env) => uriOpener(buildUri(process.env.HANDOFF_URI_SCHEME, buildPrompt(nonce)), env),
    cursorWindowCount: countCursorWindows,
  }
}

function cliRotate(input, d) {
  const env = childEnv(d.env)
  const configured = d.env.HANDOFF_TERMINAL_EXE
  const candidate = path.join(d.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe')
  const hasWt = Boolean(configured || d.existsSync(candidate))
  const exe = hasWt ? terminalExe(d) : 'claude'
  const argv = buildCliArgv({ exe: hasWt ? exe : 'wt.exe', cwd: input.cwd, runDir: input.run_dir, nonce: input.nonce, settingsPath: input.settings_path })
  const claudeArgs = argv.slice(6)
  const output = d.platform === 'win32'
    ? d.exec('powershell', ['-NoProfile', '-Command', hasWt ? launchScript(exe, argv.slice(1)) : launchScript('claude', claudeArgs, { workingDirectory: input.cwd })], { env })
    : d.exec('claude', claudeArgs, { env })
  const pid = pidFrom(output)
  return pid === null
    ? { ok: false, mode: 'terminal', pid: null, error: 'halt:launch_failed pid_assertion' }
    : { ok: true, mode: 'terminal', pid, error: null }
}

function rotate(input, injected) {
  const d = { ...defaults(), ...(injected || {}) }
  try {
    if (!validInput(input)) return { ok: false, mode: null, pid: null, error: 'bad_input' }
    if (input.host === 'cli') return cliRotate(input, d)
    let count
    try { count = d.cursorWindowCount(input.cwd, d) } catch { return { ok: false, mode: 'cursor', pid: null, error: 'halt:launch_failed window_enum_failed' } }
    if (count > 1) return { ok: false, mode: 'cursor', pid: null, error: 'halt:launch_failed multi_window' }
    const env = childEnv(d.env)
    d.openWindow(input.cwd, env)
    let foregroundConfirmed
    try { foregroundConfirmed = d.waitForeground(input.cwd, env) } catch { foregroundConfirmed = false }
    if (!foregroundConfirmed) return { ok: false, mode: 'cursor', pid: null, error: 'halt:launch_failed foreground_not_confirmed' }
    d.fireUri(input.nonce, env)
    return { ok: true, mode: 'cursor', pid: null, error: null }
  } catch {
    return { ok: false, mode: input && input.host === 'cursor' ? 'cursor' : 'terminal', pid: null, error: 'halt:launch_failed spawn_threw' }
  }
}

function main(stdinText, injected) {
  let input
  try { input = JSON.parse(String(stdinText == null ? '' : stdinText)) } catch { input = null }
  const output = rotate(input, injected)
  return { output, exitCode: output.ok === true ? 0 : 1 }
}

if (require.main === module) {
  let stdin = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => { stdin += chunk })
  process.stdin.on('end', () => {
    const result = main(stdin)
    process.stdout.write(`${JSON.stringify(result.output)}\n`)
    process.exitCode = result.exitCode
  })
}

module.exports = { ROTATE_PROMPT_RE, buildPrompt, buildCliArgv, rotate, main }
