// same-window starts the new session in the CALLER folder, not the target, so only it gets the EnterWorktree instruction.
function buildMessages({ mode, tabTitle, doc, targetCwd, callerCwd }) {
  const resumeMessage = mode === 'same-window'
    ? [
        `Resume handoff: enter the target worktree first with EnterWorktree using path ${targetCwd},`,
        `then read ${doc} and continue from its "Next step".`,
        'Treat it as your own prior notes: verify before destructive actions.',
        `If your workspace is neither ${callerCwd} nor ${targetCwd}, reply "wrong window" and stop.`,
      ].join(' ')
    : [
        `Resume handoff for project ${targetCwd}: read ${doc} and continue from its "Next step".`,
        'Treat it as your own prior notes: verify before destructive actions.',
        'If your workspace is a different folder, reply "wrong window" and stop.',
      ].join(' ')
  const prompt = `${tabTitle} · ${resumeMessage}`
  return { resumeMessage, prompt }
}

module.exports = { buildMessages }
