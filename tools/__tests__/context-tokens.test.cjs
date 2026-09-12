const { test } = require('node:test')
const assert = require('node:assert')
const { parseContextTokens } = require('../context-tokens.cjs')

function usageLine(tokens, sessionId = 's1', extra = {}) {
  return JSON.stringify({
    type: 'assistant', sessionId, isSidechain: false,
    message: { role: 'assistant', usage: {
      input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1,
    } },
    ...extra,
  })
}

test('sums input + both cache fields of the newest assistant line, excluding output_tokens', () => {
  const line = JSON.stringify({
    type: 'assistant', sessionId: 's1', isSidechain: false,
    message: { role: 'assistant', usage: {
      input_tokens: 32, cache_creation_input_tokens: 1117, cache_read_input_tokens: 132901, output_tokens: 4693,
    } },
  })
  const parsed = parseContextTokens([usageLine(5), line].join('\n'), { sessionId: 's1' })
  assert.equal(parsed.tokens, 134050)
  assert.equal(parsed.cacheRead, 132901)
  assert.equal(parsed.cacheCreation, 1117)
})

test('missing cache fields read as 0', () => {
  const line = JSON.stringify({ type: 'assistant', sessionId: 's1', message: { role: 'assistant', usage: { input_tokens: 9 } } })
  const parsed = parseContextTokens(line, { sessionId: 's1' })
  assert.deepEqual({ tokens: parsed.tokens, cacheRead: parsed.cacheRead, cacheCreation: parsed.cacheCreation }, { tokens: 9, cacheRead: 0, cacheCreation: 0 })
})

test('byteOffset is the byte position just past the matching line', () => {
  const first = usageLine(5)
  const second = usageLine(7)
  const parsed = parseContextTokens(`${first}\n${second}\n`, { sessionId: 's1' })
  assert.equal(parsed.byteOffset, Buffer.byteLength(first) + 1 + Buffer.byteLength(second))
})

test('baseOffset shifts byteOffset (a tail window starts mid-file)', () => {
  const line = usageLine(5)
  assert.equal(parseContextTokens(line, { sessionId: 's1', baseOffset: 100 }).byteOffset, 100 + Buffer.byteLength(line))
})

test('skips sidechain lines, other sessions, garbage and partial lines', () => {
  const text = [
    '{garbage',
    usageLine(100, 's1'),
    usageLine(999999, 'other'),
    usageLine(777777, 's1', { isSidechain: true }),
    '{"type":"assistant","sessionId":"s1"',
  ].join('\n')
  assert.equal(parseContextTokens(text, { sessionId: 's1' }).tokens, 100)
})

test('lines without usage or of another type are not matches', () => {
  const text = [
    usageLine(100, 's1'),
    JSON.stringify({ type: 'user', sessionId: 's1', message: { role: 'user', content: 'x' } }),
    JSON.stringify({ type: 'assistant', sessionId: 's1', message: { role: 'assistant' } }),
  ].join('\n')
  assert.equal(parseContextTokens(text, { sessionId: 's1' }).tokens, 100)
})

test('an empty sessionId filter accepts every session', () => {
  assert.equal(parseContextTokens(usageLine(9, 'whatever'), { sessionId: '' }).tokens, 9)
})

test('empty text or no matching line → null', () => {
  assert.equal(parseContextTokens('', { sessionId: 's1' }), null)
  assert.equal(parseContextTokens(usageLine(1, 'x'), { sessionId: 's1' }), null)
})
