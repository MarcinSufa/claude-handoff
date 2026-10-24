// herdr spawn: a fresh Claude session in a new herdr tab (Linux terminal workspace, `HERDR_ENV=1` inside it).
// Recipe verified by hand on 2026-09-28:
//   herdr tab create --cwd <dir> --label <label>            -> JSON result.root_pane.pane_id
//   herdr agent start <name> --kind claude --pane <pane> -- <claude args>
//   a folder Claude has not trusted yet stops at the trust dialog and `agent start` fails with agent_not_ready;
//   `herdr agent read <name>` shows it, and `herdr agent send-keys <name> down enter` picks "Yes, I trust this
//   folder" (the dialog focuses "No" first), after which Claude submits the prompt on its own
//   herdr agent get <name>                                   -> result.agent.agent_status (working once it runs)
// Every herdr call goes through deps.exec so tests drive it with fakes and never open a real tab.
const { execFileSync } = require('node:child_process')

function herdrActive(env) {
  return (env || process.env).HERDR_ENV === '1'
}

function herdrBin(env) {
  return (env && env.HERDR_BIN_PATH) || 'herdr'
}

// herdr names agents by free text; keep it to [a-z0-9-] plus a short time suffix so a respawn of the same
// title does not collide with the agent of the previous attempt.
function agentName(label, now) {
  const slug = String(label == null ? '' : label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `${slug || 'handoff'}-${Number(now || Date.now()).toString(36).slice(-4)}`
}

function parseJson(text) {
  try { return JSON.parse(String(text)) } catch { return null }
}

function errorText(error) {
  return [error && error.stdout, error && error.stderr, error && error.message].filter(Boolean).map(String).join('\n')
}

function agentStatus(output) {
  const json = parseJson(output)
  return (json && json.result && json.result.agent && json.result.agent.agent_status) || null
}

// Returns { ok, agent, paneId, tabId, status, trustAccepted, error }. Throws only when no tab could be
// created (herdr missing, no server): then nothing exists and the caller may fall back to another opener.
// Once the tab exists it never throws, so the caller does not open a second session somewhere else.
function herdrLaunch({ cwd, label, args, name, confirm, deps }) {
  const d = { exec: execFileSync, env: process.env, now: Date.now, startTimeoutMs: 20000, waitMs: 30000, ...(deps || {}) }
  const bin = herdrBin(d.env)
  const run = (argv, timeout) => d.exec(bin, argv, { env: d.env, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] })

  const created = parseJson(run(['tab', 'create', '--cwd', cwd, '--label', String(label || 'handoff')], 15000))
  const pane = created && created.result && created.result.root_pane
  if (!pane || !pane.pane_id) throw new Error('herdr tab create returned no root pane id')
  const agent = name || agentName(label, d.now())
  const out = { ok: false, agent, paneId: pane.pane_id, tabId: pane.tab_id || null, status: null, trustAccepted: false, error: null }

  try {
    run(['agent', 'start', agent, '--kind', 'claude', '--pane', out.paneId, '--timeout', String(d.startTimeoutMs), '--', ...(args || [])],
      d.startTimeoutMs + 5000)
  } catch (error) {
    const text = errorText(error)
    if (!/agent_not_ready/.test(text)) return { ...out, error: firstLine(text) || 'herdr agent start failed' }
    let screen = ''
    try { screen = String(run(['agent', 'read', agent], 10000)) } catch { /* judged below */ }
    if (!/trust/i.test(screen)) return { ...out, error: 'agent_not_ready (no trust dialog on screen)' }
    try {
      run(['agent', 'send-keys', agent, 'down', 'enter'], 10000)
      out.trustAccepted = true
    } catch (keyError) {
      return { ...out, error: firstLine(errorText(keyError)) || 'herdr send-keys failed' }
    }
  }

  if (!confirm) return { ...out, ok: true }
  try { run(['agent', 'wait', agent, '--until', 'working', '--until', 'done', '--timeout', String(d.waitMs)], d.waitMs + 5000) } catch { /* read the status below */ }
  try { out.status = agentStatus(run(['agent', 'get', agent], 10000)) } catch { out.status = null }
  const ok = out.status === 'working' || out.status === 'done'
  return { ...out, ok, error: ok ? null : `agent status ${out.status || 'unknown'}` }
}

function firstLine(text) {
  const line = String(text || '').split('\n').map((l) => l.trim()).find(Boolean)
  if (!line) return ''
  const json = parseJson(line)
  return (json && json.error && (json.error.code || json.error.message)) || line.slice(0, 200)
}

module.exports = { herdrActive, herdrBin, herdrLaunch, agentName }
