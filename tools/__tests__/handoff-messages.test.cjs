const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildMessages } = require('../handoff-messages.cjs')

const base = { tabTitle: 'panel verdicts #2', doc: '/proj/.claude/handoff/HANDOFF.md', targetCwd: '/proj' }

test('same-window with the caller folder equal to the target: no EnterWorktree, no "neither X nor X"', () => {
  for (const callerCwd of ['/proj', '/proj/']) {
    const { resumeMessage, prompt } = buildMessages({ ...base, mode: 'same-window', callerCwd, callerIsRepo: true })
    assert.doesNotMatch(resumeMessage, /EnterWorktree/)
    assert.doesNotMatch(resumeMessage, /neither/)
    assert.match(resumeMessage, /If your workspace is not \/proj, reply "wrong window"/)
    assert.ok(resumeMessage.includes(base.doc))
    assert.ok(prompt.startsWith('panel verdicts #2 · '))
  }
})

test('same-window from a different repo folder still enters the target worktree', () => {
  const { resumeMessage } = buildMessages({ ...base, mode: 'same-window', callerCwd: '/other', callerIsRepo: true })
  assert.match(resumeMessage, /EnterWorktree using path \/proj/)
  assert.match(resumeMessage, /neither \/other nor \/proj/)
})

test('same-window from a non-repo folder uses absolute paths', () => {
  const { resumeMessage } = buildMessages({ ...base, mode: 'same-window', callerCwd: '/other', callerIsRepo: false })
  assert.match(resumeMessage, /ABSOLUTE paths under \/proj/)
  assert.doesNotMatch(resumeMessage, /EnterWorktree/)
})

test('every resume text continues on its own and asks only before destructive steps', () => {
  const variants = [
    { mode: 'same-window', callerCwd: '/proj', callerIsRepo: true },
    { mode: 'same-window', callerCwd: '/other', callerIsRepo: true },
    { mode: 'same-window', callerCwd: '/other', callerIsRepo: false },
    { mode: 'terminal', callerCwd: '/other', callerIsRepo: true },
    { mode: 'herdr', callerCwd: '/proj', callerIsRepo: true },
  ]
  for (const v of variants) {
    const { resumeMessage } = buildMessages({ ...base, ...v })
    assert.match(resumeMessage, /continue from its "Next step"/, v.mode)
    assert.match(resumeMessage, /only before a destructive or irreversible step/, v.mode)
    assert.doesNotMatch(resumeMessage, /without confirming|Do NOT (auto-)?run/i, v.mode)
  }
})
