function usageOf(line, sessionId) {
  let entry
  try { entry = JSON.parse(line) } catch { return null }
  if (!entry || entry.type !== 'assistant' || entry.isSidechain === true) return null
  if (sessionId && entry.sessionId != null && entry.sessionId !== sessionId) return null
  const usage = entry.message && entry.message.usage
  if (!usage || typeof usage !== 'object') return null
  const cacheRead = Number(usage.cache_read_input_tokens || 0)
  const cacheCreation = Number(usage.cache_creation_input_tokens || 0)
  const tokens = Number(usage.input_tokens || 0) + cacheCreation + cacheRead
  return Number.isFinite(tokens) ? { tokens, cacheRead, cacheCreation } : null
}

// byteOffset points just past the matching line's content, so a line appended after a baseline
// taken at the file size compares strictly greater than that baseline.
function parseContextTokens(text, { sessionId, baseOffset = 0 } = {}) {
  const lines = String(text || '').split('\n')
  let offset = baseOffset
  let newest = null
  for (const line of lines) {
    const end = offset + Buffer.byteLength(line)
    const usage = usageOf(line, sessionId)
    if (usage) newest = { ...usage, byteOffset: end }
    offset = end + 1
  }
  return newest
}

module.exports = { parseContextTokens }
