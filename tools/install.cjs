const fs = require('node:fs')

// Merge a hook into a settings.json under the given event (default SessionStart). Secret-safe: 0600
// backup, deleted on success; restores on failure. Idempotent (matches on the exact command). Preserves
// any existing hooks for that event (e.g. another SessionStart hook, or another PostToolUse hook).
// opts.timeout (seconds) is written on a new entry and added to an already installed one that lacks it.
function installHook(settingsPath, hookAbsPath, eventName = 'SessionStart', opts = {}) {
  const raw = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '{}'
  let cfg
  try { cfg = JSON.parse(raw) } catch (e) { throw new Error(`refusing to mutate unparseable settings: ${e.message}`) }
  const bak = settingsPath + '.bak'
  fs.writeFileSync(bak, raw, { mode: 0o600 }) // settings.json holds live secrets: keep the backup private
  try {
    cfg.hooks = cfg.hooks || {}
    cfg.hooks[eventName] = cfg.hooks[eventName] || []
    const command = `node "${hookAbsPath}"`
    const mine = cfg.hooks[eventName].flatMap((g) => (g.hooks || []).filter((h) => h.command === command))
    const exists = mine.length > 0
    let timeoutSet = false
    if (opts.timeout !== undefined) {
      for (const h of mine) if (h.timeout === undefined) { h.timeout = opts.timeout; timeoutSet = true }
    }
    if (!exists) {
      const hook = { type: 'command', command }
      if (opts.timeout !== undefined) hook.timeout = opts.timeout
      const group = { hooks: [hook] }
      if (opts.matcher !== undefined) group.matcher = opts.matcher // PostToolUse uses a matcher; '' = all tools
      cfg.hooks[eventName].push(group)
    }
    const tmp = settingsPath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2))
    fs.renameSync(tmp, settingsPath)
    fs.rmSync(bak, { force: true }) // delete the plaintext backup on success
    return { ok: true, added: !exists, timeoutSet }
  } catch (e) {
    fs.copyFileSync(bak, settingsPath); fs.rmSync(bak, { force: true }) // restore on failure
    throw e
  }
}

// Same timeouts as hooks/hooks.json (seconds); both hooks normally finish in well under a second.
const TIMEOUTS = { SessionStart: 10, PostToolUse: 5 }

// Wire both halves of the skill: the SessionStart resume hook and the PostToolUse auto-trigger.
function installAll(settingsPath, { sessionStart, postToolUse }) {
  const out = {}
  if (sessionStart) out.sessionStart = installHook(settingsPath, sessionStart, 'SessionStart', { timeout: TIMEOUTS.SessionStart })
  if (postToolUse) out.postToolUse = installHook(settingsPath, postToolUse, 'PostToolUse', { matcher: '', timeout: TIMEOUTS.PostToolUse })
  return out
}

module.exports = { installHook, installAll, TIMEOUTS }

if (require.main === module) {
  const os = require('node:os'); const path = require('node:path')
  const settings = path.join(os.homedir(), '.claude', 'settings.json')
  const sessionStart = path.join(__dirname, '..', 'hooks', 'sessionstart-handoff.cjs')
  const postToolUse = path.join(__dirname, '..', 'hooks', 'usage-monitor.cjs')
  const r = installAll(settings, { sessionStart, postToolUse })
  process.stdout.write(JSON.stringify({ ...r, settings, sessionStart, postToolUse }, null, 2) + '\n')
}
