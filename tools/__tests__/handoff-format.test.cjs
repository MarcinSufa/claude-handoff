const { test } = require('node:test'); const assert = require('node:assert')
const { toMarkdown, parseDoc, FIELDS } = require('../handoff-format.cjs')

const fields = {
  goal: 'Wire the keyType fix', specifics: ['register-tools.ts:212'], state: 'Root-caused.',
  nextStep: 'Apply the fix', constraints: ['pnpm only'], gotchas: ['remote != npx'],
  openQuestions: ['bump npx?'], keepOnFail: ['keyType dropped on desc encrypt'], verify: ['npm test'],
}
const meta = { fromSessionId: 'sess-1', projectRoot: '/p', trigger: 'manual', memoryId: null }

test('round-trips all 9 fields through markdown', () => {
  const md = toMarkdown(fields, meta)
  const parsed = parseDoc(md)
  for (const f of FIELDS) assert.deepEqual(parsed.fields[f], fields[f])
  assert.equal(parsed.meta.fromSessionId, 'sess-1')
})
test('prose body contains goal + nextStep headers', () => {
  const md = toMarkdown(fields, meta)
  assert.ok(md.includes('## Goal')); assert.ok(md.includes('## Next step'))
  assert.ok(md.includes('Apply the fix'))
})
