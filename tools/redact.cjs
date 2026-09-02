// Strip secrets before ANY write (file AND off-machine memory). Spec §7.
const PATTERNS = [
  [/-----BEGIN ([A-Z ]*PRIVATE KEY)-----\n(?:(?!-----BEGIN )[^\n]*\n)*?-----END \1-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/\b(postgres(?:ql)?|mongodb(?:\+srv)?|mysql|rediss?|amqps?|mssql):\/\/[^:\s/]+:[^@\s]+@/gi, '$1://[REDACTED]@'],
  [/\b[rs]k_live_[A-Za-z0-9]+/g, '[REDACTED_STRIPE]'],
  [/\bexv_[A-Za-z0-9._-]{6,}/g, '[REDACTED_KEY]'],
  [/\b(?:sk-ant-|sk-proj-|ghp_|gho_|ghs_|github_pat_|glpat-|npm_)[A-Za-z0-9._-]+/g, '[REDACTED_TOKEN]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED_SLACK]'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_GOOGLE]'],
  [/\bsk-[A-Za-z0-9]{20,}\b/g, '[REDACTED_OPENAI]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]'],
  [/(\bbearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1[REDACTED]'],
  [/((?:api[_-]?key|authorization|bearer|token|secret|password)"?\s*[:=]\s*)("?)(?!bearer\b)[^\s"',}]{6,}\2/gi, '$1[REDACTED]'],
]

function redact(text) {
  let out = String(text == null ? '' : text)
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep)
  return out
}

module.exports = { redact, PATTERNS }
