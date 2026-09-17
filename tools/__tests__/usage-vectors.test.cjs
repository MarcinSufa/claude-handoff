const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const fixture = require('./fixtures/usage-vectors.json')
const { parseContextTokens, windowForModel } = require('../context-tokens.cjs')
const { readNewestUsage } = require('../transcript-tail.cjs')

function dir() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-usage-vec-'))) }

// Item 7: the winning line's model id per case (read directly off the fixture's own
// transcript_jsonl content above), so parseContextTokens's new `model` field is asserted against
// data, not against a value the test re-derives by parsing the transcript itself independently of
// the module under test.
const EXPECTED_MODEL_BY_CASE = {
  sidechain_line_skipped: 'claude-haiku-4-5-20251001',
  foreign_sessionId_skipped: 'claude-haiku-4-5-20251001',
  truncated_first_line_of_tail_window: 'claude-haiku-4-5-20251001',
  model_id_1m_suffix_sets_window: 'claude-sonnet-5-20260101[1m]',
}

// C15: cross-repo usage equivalence. Every cases[] row driven through parseContextTokens, and
// through readNewestUsage on a temp file for the file-shaped (line_split) case.
// D1 (conductor ruling): the fixture is the cross-repo authority (C15/C19); byteOffset is just past
// the matched line's TERMINATOR when the line is newline-terminated (LF-inclusive), and just past
// the content only when the matched line is the last line of the transcript and carries no
// terminator. A real JSONL transcript terminates every line including the last (the same convention
// transcript-tail.test.cjs already uses in its `write()` helper: `lines.join('\n') + '\n'`), so the
// fixture's transcript_jsonl arrays are joined with a trailing '\n' here to represent that; every
// row's byteOffset then matches the fixture verbatim.
test('usage-vectors.json: parseContextTokens over every transcript_jsonl case (tokens/outputTokens/cacheRead/cacheCreation/byteOffset)', () => {
  for (const c of fixture.cases) {
    if (!c.transcript_jsonl) continue
    const text = `${c.transcript_jsonl.join('\n')}\n`
    const result = parseContextTokens(text, { sessionId: fixture.this_session, baseOffset: 0 })
    if (c.expected.tokens === null) {
      assert.equal(result, null, `${c.name}: expected null (unparsable split line, must widen)`)
      continue
    }
    assert.ok(result, `${c.name}: expected a usage tuple`)
    assert.equal(result.tokens, c.expected.tokens, c.name)
    assert.equal(result.outputTokens, c.expected.outputTokens, `${c.name}: outputTokens (message.usage.output_tokens)`)
    assert.equal(result.cacheRead, c.expected.cacheRead, c.name)
    assert.equal(result.cacheCreation, c.expected.cacheCreation, c.name)
    assert.equal(result.byteOffset, c.expected.byteOffset, `${c.name}: byteOffset per D1 (LF-inclusive terminator, fixture wins)`)
    assert.equal(result.model, EXPECTED_MODEL_BY_CASE[c.name], `${c.name}: the model field must carry the winning line's message.model`)
  }
})

// Item 7: windowForModel must be exercised on the value parseContextTokens itself returns in
// .model, not a value the test parses independently off the transcript.
test('model_id_1m_suffix_sets_window: windowForModel(parseContextTokens(...).model) is 1000000 for a [1m]-suffixed model id', () => {
  const c = fixture.cases.find((x) => x.name === 'model_id_1m_suffix_sets_window')
  assert.ok(c, 'fixture must carry the model_id_1m_suffix_sets_window case')
  const text = `${c.transcript_jsonl.join('\n')}\n`
  const result = parseContextTokens(text, { sessionId: fixture.this_session, baseOffset: 0 })
  assert.equal(result.model, 'claude-sonnet-5-20260101[1m]')
  assert.equal(windowForModel(result.model), c.expected.window_W)
  assert.equal(windowForModel(result.model), 1000000)
})

test('windowForModel returns 200000 for a model id with no [1m] suffix', () => {
  assert.equal(windowForModel('claude-sonnet-5-20260101'), 200000)
  assert.equal(windowForModel('claude-haiku-4-5-20251001'), 200000)
})

// line_split_across_64KB_boundary: the widening path. A 64 KB window sees an unparsable fragment
// (asserted above via parseContextTokens returning null); a real file with the full line placed
// after >64 KB of padding must still yield the full tuple once transcript-tail.cjs widens past
// 64 KB -> 256 KB.
test('line_split_across_64KB_boundary: readNewestUsage on a real >64KB temp file widens past the split and returns the full tuple', () => {
  const c = fixture.cases.find((x) => x.name === 'line_split_across_64KB_boundary')
  assert.ok(c, 'fixture must carry the line_split_across_64KB_boundary case')
  const padding = 'x'.repeat(70 * 1024)
  const file = path.join(dir(), 't.jsonl')
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', message: { content: padding } })}\n${c.transcript_full_line}\n`)

  const result = readNewestUsage(file, { sessionId: fixture.this_session, minOffset: 0 })
  assert.ok(result, 'the widening path must find the full line once past 64KB')
  const parsedLine = JSON.parse(c.transcript_full_line)
  const expectedTokens = parsedLine.message.usage.input_tokens + parsedLine.message.usage.cache_creation_input_tokens + parsedLine.message.usage.cache_read_input_tokens
  assert.equal(result.tokens, expectedTokens)
  assert.equal(result.outputTokens, parsedLine.message.usage.output_tokens)
  assert.equal(result.cacheRead, parsedLine.message.usage.cache_read_input_tokens)
  assert.equal(result.cacheCreation, parsedLine.message.usage.cache_creation_input_tokens)
})

// D1's other half, not covered by any usage-vectors.json row: a final line with NO trailing
// newline reports the content-end offset, not content-end + 1 (the terminator that isn't there
// is never counted). Driven through both parseContextTokens directly and readNewestUsage on a
// real temp file written without a trailing '\n'.
test('D1: a final line with no trailing newline reports the content-end offset, not content-end + 1', () => {
  const line = JSON.stringify({
    type: 'assistant', sessionId: fixture.this_session, isSidechain: false,
    message: { model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } },
  })

  const direct = parseContextTokens(line, { sessionId: fixture.this_session, baseOffset: 0 })
  assert.ok(direct)
  assert.equal(direct.byteOffset, Buffer.byteLength(line), 'no terminator in the text: offset stops at content end')

  const file = path.join(dir(), 'no-trailing-newline.jsonl')
  fs.writeFileSync(file, line)
  const fromFile = readNewestUsage(file, { sessionId: fixture.this_session, minOffset: 0 })
  assert.ok(fromFile)
  assert.equal(fromFile.byteOffset, Buffer.byteLength(line), 'file has no trailing newline: offset stops at content end')
})
