const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { toMarkdown } = require('../handoff-format.cjs')

// G-2: tools/handoff-format.cjs stays unchanged. Renders handoff-golden/input.json and compares to
// expected.md byte for byte. D4: both are copied byte-identical into tools/__tests__/fixtures/
// (verified by sha256, see the gate report) so this suite does not depend on the coordinator
// worktree.
test('handoff-golden: toMarkdown(input.fields, input.meta) equals expected.md byte for byte', () => {
  const input = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/handoff-golden/input.json`, 'utf8'))
  const expected = fs.readFileSync(`${__dirname}/fixtures/handoff-golden/expected.md`, 'utf8')
  const actual = toMarkdown(input.fields, input.meta)
  assert.equal(actual, expected)
})
