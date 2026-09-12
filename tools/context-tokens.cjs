function usageOf(line, sessionId) {
  let entry
  try { entry = JSON.parse(line) } catch { return null }
  if (!entry || entry.type !== 'assistant' || entry.isSidechain === true) return null
  if (sessionId && entry.sessionId != null && entry.sessionId !== sessionId) return null
  const usage = entry.message && entry.message.usage
  if (!usage || typeof usage !== 'object') return null
  const tokens = Number(usage.input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0) + Number(usage.cache_read_input_tokens || 0)
  return Number.isFinite(tokens) ? tokens : null
}

// byteOffset points just past the matching line's content, so a line appended after a baseline
// taken at the file size compares strictly greater than that baseline.
function parseContextTokens(text, { sessionId, baseOffset = 0 } = {}) {
  const lines = String(text || '').split('\n')
  let offset = baseOffset
  let newest = null
  for (const line of lines) {
    const end = offset + Buffer.byteLength(line)
    const tokens = usageOf(line, sessionId)
    if (tokens != null) newest = { tokens, byteOffset: end }
    offset = end + 1
  }
  return newest
}

module.exports = { parseContextTokens }
