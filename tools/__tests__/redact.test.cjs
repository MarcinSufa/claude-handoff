const { test } = require('node:test'); const assert = require('node:assert')
const { redact } = require('../redact.cjs')

test('redacts postgres URL with embedded credentials', () => {
  const out = redact('DATABASE_URL=postgresql://postgres.abc:p4ssw0rd-EXAMPLE@host:5432/db')
  assert.ok(!out.includes('p4ssw0rd-EXAMPLE'))
  assert.ok(out.includes('[REDACTED]'))
})
test('redacts Stripe live + exv_ + cursor key', () => {
  const out = redact('rk_live_ABC123 exv_def456ghi CURSOR_API_KEY=zzz12345')
  assert.ok(!out.includes('rk_live_ABC123'))
  assert.ok(!out.includes('exv_def456ghi'))
  assert.ok(!out.includes('zzz12345'))
})
test('leaves ordinary prose untouched', () => {
  const s = 'Wire create_task keyType fix at register-tools.ts:212'
  assert.equal(redact(s), s)
})
test('Authorization: Bearer keeps the scheme word and redacts only the token', () => {
  assert.equal(redact('Authorization: Bearer abcdef123456'), 'Authorization: Bearer [REDACTED]')
})
test('redacts quoted JSON key values', () => {
  const out = redact('{"token": "abc123456", "password": "hunter2hunter2"}')
  assert.ok(!out.includes('abc123456'))
  assert.ok(!out.includes('hunter2hunter2'))
  assert.ok(out.includes('"token"'))
})
test('redacts AWS access key ids', () => {
  assert.ok(!redact('key AKIAIOSFODNN7EXAMPLE here').includes('AKIAIOSFODNN7EXAMPLE'))
})
test('redacts Slack tokens', () => {
  assert.ok(!redact('SLACK=xoxb-1234567890-abcdefghij').includes('xoxb-1234567890-abcdefghij'))
})
test('redacts Google API keys', () => {
  assert.ok(!redact('AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q').includes('AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'))
})
test('redacts OpenAI legacy sk- keys', () => {
  assert.ok(!redact('OPENAI sk-abcdefghijklmnopqrstuvwxyz0123').includes('sk-abcdefghijklmnopqrstuvwxyz0123'))
})
test('redacts ghs_, glpat- and npm_ tokens', () => {
  const out = redact('ghs_abcdef123456 glpat-abcdef123456 npm_abcdef123456')
  assert.ok(!out.includes('ghs_abcdef123456'))
  assert.ok(!out.includes('glpat-abcdef123456'))
  assert.ok(!out.includes('npm_abcdef123456'))
})
test('redacts JWTs', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
  assert.ok(!redact('Bearer ' + jwt).includes(jwt))
})
test('redacts PEM private key blocks', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----'
  const out = redact('before\n' + pem + '\nafter')
  assert.ok(!out.includes('MIIEowIBAAKCAQEA'))
  assert.ok(!out.includes('BEGIN RSA'))
  assert.ok(out.includes('before') && out.includes('after'))
})
test('redacts credentials in mongodb, mongodb+srv, mysql, redis, amqp and mssql URLs', () => {
  for (const scheme of ['mongodb', 'mongodb+srv', 'mysql', 'redis', 'amqp', 'mssql']) {
    const out = redact(`${scheme}://user:s3cretpw@host/db`)
    assert.ok(!out.includes('s3cretpw'), scheme)
    assert.ok(!out.includes('user:'), scheme)
    assert.ok(out.includes('[REDACTED]@host/db'), scheme)
  }
})
test('an unmatched BEGIN does not swallow prose up to a later block END', () => {
  const input = '-----BEGIN PRIVATE KEY-----\nabc\nsome prose\n-----BEGIN RSA PRIVATE KEY-----\nxyz\n-----END RSA PRIVATE KEY-----'
  const out = redact(input)
  assert.ok(out.includes('some prose'))
  assert.ok(!out.includes('xyz'))
  assert.ok(!out.includes('BEGIN RSA'))
  assert.ok(out.includes('[REDACTED_PRIVATE_KEY]'))
})
test('END label must match BEGIN label', () => {
  const out = redact('-----BEGIN EC PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')
  assert.equal(out.includes('[REDACTED_PRIVATE_KEY]'), false)
})
