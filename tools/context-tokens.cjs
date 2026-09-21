function usageOf(line, sessionId) {
  let entry
  try { entry = JSON.parse(line) } catch { return null }
  if (!entry || entry.type !== 'assistant' || entry.isSidechain === true) return null
  if (sessionId && entry.sessionId != null && entry.sessionId !== sessionId) return null
  const message = entry.message
  const usage = message && message.usage
  if (!usage || typeof usage !== 'object') return null
  const cacheRead = Number(usage.cache_read_input_tokens || 0)
  const cacheCreation = Number(usage.cache_creation_input_tokens || 0)
  const tokens = Number(usage.input_tokens || 0) + cacheCreation + cacheRead
  const outputTokens = Number(usage.output_tokens || 0)
  if (!Number.isFinite(tokens) || !Number.isFinite(outputTokens)) return null
  return { tokens, outputTokens, cacheRead, cacheCreation, model: message.model }
}

function parseContextTokens(text, { sessionId, baseOffset = 0 } = {}) {
  const lines = String(text || '').split('\n')
  let offset = baseOffset
  let newest = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const end = offset + Buffer.byteLength(line)
    const usage = usageOf(line, sessionId)
    if (usage) newest = { ...usage, byteOffset: end + (i < lines.length - 1 ? 1 : 0) }
    offset = end + (i < lines.length - 1 ? 1 : 0)
  }
  return newest
}

function windowForModel(model) {
  return typeof model === 'string' && /\[1m\]$/.test(model) ? 1000000 : 200000
}

module.exports = { parseContextTokens, windowForModel }
