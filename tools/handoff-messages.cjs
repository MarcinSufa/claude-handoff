const path = require('node:path')

// One rule for every resume text: continue on your own, ask only before destructive steps. (The old
// wording said both "continue from Next step" and "do NOT run Next step without confirming".)
const SAFETY = 'Treat it as your own prior notes: check them against the live repo, then continue on your own;' +
  ' ask the user first only before a destructive or irreversible step (deleting data, force-push, migrations, deploys, messages to others).'

function samePath(a, b) {
  if (!a || !b) return false
  const norm = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r }
  return norm(a) === norm(b)
}

// same-window starts the new session in the CALLER folder, not the target, so only it gets the EnterWorktree
// instruction, and only when the caller folder differs from the target.
function buildMessages({ mode, tabTitle, doc, targetCwd, callerCwd, callerIsRepo }) {
  const sameFolder = samePath(callerCwd, targetCwd)
  const wrongWindow = sameFolder
    ? `If your workspace is not ${targetCwd}, reply "wrong window" and stop.`
    : `If your workspace is neither ${callerCwd} nor ${targetCwd}, reply "wrong window" and stop.`
  let resumeMessage
  if (mode !== 'same-window') {
    resumeMessage = [
      `Resume handoff for project ${targetCwd}: read ${doc} and continue from its "Next step".`,
      SAFETY,
      'If your workspace is a different folder, reply "wrong window" and stop.',
    ].join(' ')
  } else if (sameFolder) {
    resumeMessage = [`Resume handoff: read ${doc} and continue from its "Next step".`, SAFETY, wrongWindow].join(' ')
  } else if (callerIsRepo === false) {
    resumeMessage = [
      `Resume handoff: this window is not a git repository, so worktree tooling is unavailable.`,
      `Work on ABSOLUTE paths under ${targetCwd} instead: cd into ${targetCwd} in every shell command,`,
      `and use the full path in Read and Edit. Read ${doc} and continue from its "Next step".`,
      SAFETY,
      wrongWindow,
    ].join(' ')
  } else {
    resumeMessage = [
      `Resume handoff: enter the target worktree first with EnterWorktree using path ${targetCwd},`,
      `then read ${doc} and continue from its "Next step".`,
      SAFETY,
      wrongWindow,
    ].join(' ')
  }
  const prompt = `${tabTitle} · ${resumeMessage}`
  return { resumeMessage, prompt }
}

module.exports = { buildMessages, samePath, SAFETY }
