const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { readNewestUsage, WINDOWS } = require('../transcript-tail.cjs')

function dir() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-tail-'))) }
function usageLine(tokens, sessionId = 's1') {
  return JSON.stringify({
    type: 'assistant', sessionId, isSidechain: false,
    message: { role: 'assistant', usage: { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } },
  })
}
function write(lines, name = 't.jsonl') {
  const file = path.join(dir(), name)
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return file
}
const MB = 1024 * 1024

test('window sizes grow 64 KB → 256 KB → 1 MB → 4 MB', () => {
  assert.deepEqual(WINDOWS, [64 * 1024, 256 * 1024, MB, 4 * MB])
})

test('small transcript: returns the newest usage line with its absolute byte offset', () => {
  const first = usageLine(10); const last = usageLine(20)
  const r = readNewestUsage(write([first, last]), { sessionId: 's1', minOffset: 0 })
  assert.equal(r.tokens, 20)
  assert.equal(r.byteOffset, Buffer.byteLength(first) + 1 + Buffer.byteLength(last))
})

test('a >5 MB transcript with a 2 MB middle line still yields the last line, offset > 0', () => {
  const file = write([
    JSON.stringify({ type: 'user', message: { content: 'a'.repeat(2 * MB) } }),
    JSON.stringify({ type: 'user', message: { content: 'x'.repeat(2 * MB) } }),
    'f'.repeat(2 * MB),
    usageLine(134050),
  ])
  const r = readNewestUsage(file, { sessionId: 's1', minOffset: 0 })
  assert.equal(r.tokens, 134050)
  assert.equal(r.byteOffset, fs.statSync(file).size - 1)
})

test('a usage line only at the head of a 5 MB file is beyond the cap → null', () => {
  assert.equal(readNewestUsage(write([usageLine(1), 'z'.repeat(5 * MB)]), { sessionId: 's1', minOffset: 0 }), null)
})

test('the partial first line of a window is discarded, not misparsed', () => {
  const file = write([usageLine(5), 'p'.repeat(70 * 1024), usageLine(6)])
  assert.equal(readNewestUsage(file, { sessionId: 's1', minOffset: 0 }).tokens, 6)
})

test('minOffset at or past the newest line → null; below it → the line', () => {
  const file = write([usageLine(5)])
  const r = readNewestUsage(file, { sessionId: 's1', minOffset: 0 })
  assert.equal(readNewestUsage(file, { sessionId: 's1', minOffset: r.byteOffset }), null)
  assert.equal(readNewestUsage(file, { sessionId: 's1', minOffset: r.byteOffset - 1 }).tokens, 5)
})

test('missing file, empty file or a directory → null, never throws', () => {
  const d = dir()
  assert.equal(readNewestUsage(path.join(d, 'missing.jsonl'), { sessionId: 's1', minOffset: 0 }), null)
  assert.equal(readNewestUsage(write([]), { sessionId: 's1', minOffset: 0 }), null)
  assert.equal(readNewestUsage(d, { sessionId: 's1', minOffset: 0 }), null)
  assert.equal(readNewestUsage(undefined, { sessionId: 's1' }), null)
})
