const FIELDS = ['goal', 'specifics', 'state', 'nextStep', 'constraints', 'gotchas', 'openQuestions', 'keepOnFail', 'verify']
const HEADERS = {
  goal: 'Goal', specifics: 'Specifics', state: 'State', nextStep: 'Next step',
  constraints: 'Constraints', gotchas: 'Gotchas', openQuestions: 'Open questions',
  keepOnFail: 'Keep on fail', verify: 'Verify',
}
const SCALAR = new Set(['goal', 'state', 'nextStep'])

function block(field, val) {
  if (SCALAR.has(field)) return `## ${HEADERS[field]}\n${val || ''}\n`
  const items = (val || []).map((x) => `- ${x}`).join('\n')
  return `## ${HEADERS[field]}\n${items}\n`
}

function toMarkdown(fields, meta) {
  const fm = [
    '---', 'schema: handoff/v1', `createdAt: ${meta.createdAt || new Date().toISOString()}`,
    `fromSessionId: ${meta.fromSessionId == null ? 'null' : meta.fromSessionId}`,
    `projectRoot: ${meta.projectRoot || ''}`, `trigger: ${meta.trigger || 'manual'}`,
    `memoryId: ${meta.memoryId == null ? 'null' : meta.memoryId}`,
    `title: ${meta.title || ''}`, `generation: ${meta.generation || 1}`, '---', '',
  ].join('\n')
  const body = [`# Handoff: ${fields.goal || ''}`, '', ...FIELDS.map((f) => block(f, fields[f]))].join('\n')
  const json = `\n<!-- handoff:json\n${JSON.stringify({ schema: 'handoff/v1', ...fields })}\n-->\n`
  return fm + body + json
}

function parseDoc(md) {
  const jsonMatch = md.match(/<!--\s*handoff:json\s*([\s\S]*?)-->/)
  const fields = jsonMatch ? JSON.parse(jsonMatch[1].trim()) : {}
  const meta = {}
  const fm = md.match(/^---\n([\s\S]*?)\n---/)
  if (fm) for (const line of fm[1].split('\n')) {
    const i = line.indexOf(':'); if (i < 0) continue
    const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim()
    meta[k] = v === 'null' ? null : v
  }
  return { fields, meta }
}

module.exports = { toMarkdown, parseDoc, FIELDS, HEADERS }
