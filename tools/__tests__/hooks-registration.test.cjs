const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const HOOKS_JSON = path.join(__dirname, '..', '..', 'hooks', 'hooks.json')

// G-4: hooks/hooks.json registers no PreCompact and no Stop entry (fusion V1: the plugin ships no
// denier; the exo-vault hook is the only denier). PostToolUse -> hooks/usage-monitor.cjs must stay
// registered.
test('hooks.json registers no PreCompact and no Stop entry', () => {
  const hooks = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'))
  assert.equal(hooks.hooks.PreCompact, undefined, 'the plugin ships no PreCompact denier (fusion V1)')
  assert.equal(hooks.hooks.Stop, undefined, 'the plugin ships no Stop denier (fusion V1)')
})

test('hooks.json keeps PostToolUse -> hooks/usage-monitor.cjs', () => {
  const hooks = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'))
  const commands = (hooks.hooks.PostToolUse || []).flatMap((g) => g.hooks).map((h) => h.command)
  assert.ok(commands.some((c) => c.includes('usage-monitor.cjs')), 'PostToolUse -> usage-monitor.cjs must remain registered')
})
