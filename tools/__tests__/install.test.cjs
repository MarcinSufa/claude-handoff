const { test } = require('node:test'); const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { installHook, installAll } = require('../install.cjs')

function tmpSettings(obj) { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-set-')), 'settings.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f }

test('adds the SessionStart hook and is idempotent', () => {
  const f = tmpSettings({ hooks: {} })
  installHook(f, '/abs/hook.cjs'); installHook(f, '/abs/hook.cjs')
  const s = JSON.parse(fs.readFileSync(f, 'utf8'))
  const cmds = s.hooks.SessionStart.flatMap((g) => g.hooks).filter((h) => h.command.includes('hook.cjs'))
  assert.equal(cmds.length, 1)
})
test('preserves an existing SessionStart hook + deletes the .bak on success', () => {
  const f = tmpSettings({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'existing-hook.cjs' }] }] } })
  installHook(f, '/abs/hook.cjs')
  const s = JSON.parse(fs.readFileSync(f, 'utf8'))
  const all = s.hooks.SessionStart.flatMap((g) => g.hooks).map((h) => h.command)
  assert.ok(all.some((c) => c.includes('existing-hook.cjs')))
  assert.ok(all.some((c) => c.includes('hook.cjs')))
  assert.ok(!fs.existsSync(f + '.bak'))
})

test('registers a PostToolUse hook (with matcher) and is idempotent', () => {
  const f = tmpSettings({ hooks: {} })
  installHook(f, '/abs/usage-monitor.cjs', 'PostToolUse', { matcher: '' })
  installHook(f, '/abs/usage-monitor.cjs', 'PostToolUse', { matcher: '' })
  const s = JSON.parse(fs.readFileSync(f, 'utf8'))
  const groups = s.hooks.PostToolUse
  const cmds = groups.flatMap((g) => g.hooks).filter((h) => h.command.includes('usage-monitor.cjs'))
  assert.equal(cmds.length, 1)
  assert.ok(groups.some((g) => g.matcher === ''))
})

test('installAll wires BOTH SessionStart and PostToolUse, preserving existing hooks of each', () => {
  const f = tmpSettings({ hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: 'existing-hook.cjs' }] }],
    PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'other-monitor.cjs' }] }],
  } })
  installAll(f, { sessionStart: '/abs/sessionstart-handoff.cjs', postToolUse: '/abs/usage-monitor.cjs' })
  installAll(f, { sessionStart: '/abs/sessionstart-handoff.cjs', postToolUse: '/abs/usage-monitor.cjs' }) // idempotent
  const s = JSON.parse(fs.readFileSync(f, 'utf8'))
  const ss = s.hooks.SessionStart.flatMap((g) => g.hooks).map((h) => h.command)
  const pt = s.hooks.PostToolUse.flatMap((g) => g.hooks).map((h) => h.command)
  assert.ok(ss.some((c) => c.includes('existing-hook.cjs')))      // preserved
  assert.ok(ss.some((c) => c.includes('sessionstart-handoff.cjs'))) // added
  assert.ok(pt.some((c) => c.includes('other-monitor.cjs')))       // preserved
  assert.ok(pt.some((c) => c.includes('usage-monitor.cjs')))       // added
  assert.equal(pt.filter((c) => c.includes('usage-monitor.cjs')).length, 1) // not duplicated
  assert.ok(!fs.existsSync(f + '.bak'))
})
