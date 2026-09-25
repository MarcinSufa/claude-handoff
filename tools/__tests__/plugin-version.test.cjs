const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PLUGIN_JSON = path.join(__dirname, '..', '..', '.claude-plugin', 'plugin.json')
const MARKETPLACE_JSON = path.join(__dirname, '..', '..', '.claude-plugin', 'marketplace.json')

// G-3: plugin.json version 1.1.1, and the marketplace entry agrees (whatever version field that
// file actually carries; read it first, do not assume its shape).
test('plugin.json version is 1.1.1', () => {
  const plugin = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'))
  assert.equal(plugin.version, '1.1.1')
})

test('marketplace.json handoff plugin entry version agrees with plugin.json', () => {
  const plugin = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'))
  const marketplace = JSON.parse(fs.readFileSync(MARKETPLACE_JSON, 'utf8'))
  const entry = (marketplace.plugins || []).find((p) => p.name === plugin.name)
  assert.ok(entry, `marketplace.json must carry a plugin entry named ${JSON.stringify(plugin.name)}`)
  assert.equal(entry.version, plugin.version)
})
