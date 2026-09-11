const crypto = require('node:crypto')

function buildRegistryEntry({ mode, targetCwd, callerCwd, doc, pending, title, generation, now }) {
  return {
    schema: 'handoff-registry/v1',
    createdAt: now || new Date().toISOString(),
    targetCwd, callerCwd, doc, pending, title, generation,
    nonce: crypto.randomUUID(), mode,
  }
}

module.exports = { buildRegistryEntry }
