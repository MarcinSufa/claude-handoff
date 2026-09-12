const fs = require('node:fs')
const { parseContextTokens } = require('./context-tokens.cjs')

const WINDOWS = [64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024]

function readWindow(fd, start, length) {
  const buf = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, start + read)
    if (n === 0) break
    read += n
  }
  return buf.subarray(0, read)
}

function newestInWindow(fd, size, window, sessionId) {
  const start = Math.max(0, size - window)
  let buf = readWindow(fd, start, size - start)
  let baseOffset = start
  if (start > 0) {
    const firstNewline = buf.indexOf(10)
    if (firstNewline === -1) return { found: null, complete: false }
    baseOffset += firstNewline + 1
    buf = buf.subarray(firstNewline + 1)
  }
  return { found: parseContextTokens(buf.toString('utf8'), { sessionId, baseOffset }), complete: start === 0 }
}

function readNewestUsage(transcriptPath, { sessionId, minOffset = 0 } = {}) {
  if (!transcriptPath) return null
  let fd
  try {
    fd = fs.openSync(transcriptPath, 'r')
    const size = fs.fstatSync(fd).size
    for (const window of WINDOWS) {
      const { found, complete } = newestInWindow(fd, size, window, sessionId)
      if (found) return found.byteOffset > (minOffset || 0) ? found : null
      if (complete) return null
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch { /* already closed */ }
  }
}

module.exports = { readNewestUsage, WINDOWS }
