// tools/context-state.cjs: the per-session context reading every hook shares: the clear/compact
// epoch from the baseline file and the newest usage line written after that baseline.
const { readBaseline } = require('./usage-flag.cjs')
const { readNewestUsage } = require('./transcript-tail.cjs')

function readContextState(p, sessionId, transcriptPath) {
  const baseline = readBaseline(p, sessionId)
  const clearEpoch = baseline ? baseline.clearEpoch : 0
  const minOffset = baseline && transcriptPath && baseline.transcriptPath === transcriptPath ? baseline.offset : 0
  const usage = transcriptPath ? readNewestUsage(transcriptPath, { sessionId, minOffset }) : null
  return { baseline, clearEpoch, usage }
}

module.exports = { readContextState }
