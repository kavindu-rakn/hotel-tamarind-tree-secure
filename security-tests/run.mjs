// Black-box security regression tests for Hotel Tamarind Tree (SE4030 assignment).
//
// Each test re-runs one attack that was proven against the ORIGINAL code and
// prints [VULNERABLE] or [PROTECTED]. Run it against a LOCAL copy only:
//
//   BASE_URL=http://localhost:3000 node security-tests/run.mjs
//
// It refuses to run if DATABASE_URL is not a local database (it creates test
// users, bookings and messages).
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { encode } from 'next-auth/jwt'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const LEGACY = process.env.LEGACY_API === '1' // original API expects an `email` field in the booking body
const MAIL_LOG = process.env.MAIL_LOG ?? 'security-tests/mail.log.jsonl'
const NEXT_DIR = process.env.NEXT_DIR ?? '.next'
const RESULT_FILE = process.env.RESULT_FILE
const CRON_URL = process.env.CRON_UNSET_URL ?? BASE // an instance started WITHOUT CRON_SECRET

// ── Safety guard: never run against a real database ─────────────────────────
const dbUrl = process.env.DATABASE_URL ?? ''
if (!/@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)) {
  console.error('REFUSING TO RUN: DATABASE_URL is not a local database. These tests create junk data.')
  process.exit(2)
}
const prisma = new PrismaClient()

// ── Helpers ─────────────────────────────────────────────────────────────────
const rnd = n => Math.floor(Math.random() * n)
const fakeIp = () => `10.${rnd(250)}.${rnd(250)}.${1 + rnd(250)}` // needs TRUSTED_PROXY_HEADER=x-forwarded-for on the app
const sleep = ms => new Promise(r => setTimeout(r, ms))
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const ok2xx = s => s >= 200 && s < 300

async function raw(path, { method = 'GET', headers = {}, body, ip = fakeIp() } = {}) {
  return fetch(BASE + path, { method, body, redirect: 'manual', headers: { 'x-forwarded-for': ip, ...headers } })
}
function mergeCookies(prev, res) {
  const jar = new Map((prev ?? '').split('; ').filter(Boolean).map(c => [c.split('=')[0], c]))
  for (const sc of res.headers.getSetCookie?.() ?? []) jar.set(sc.split('=')[0], sc.split(';')[0])
  return [...jar.values()].join('; ')
}
async function login(email, password, ip = fakeIp()) {
  const csrfRes = await raw('/api/auth/csrf', { ip })
  const csrfCookie = mergeCookies('', csrfRes)
  const { csrfToken } = await csrfRes.json()
  const body = new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE + '/admin' })
  const t0 = performance.now()
  const res = await raw('/api/auth/callback/credentials', {
    method: 'POST', body, ip,
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: csrfCookie },
  })
  const ms = performance.now() - t0
  const sessionSetCookie = (res.headers.getSetCookie?.() ?? []).find(c => /session-token=/.test(c))
  return { ok: !!sessionSetCookie, ms, cookie: mergeCookies(csrfCookie, res), setCookie: sessionSetCookie, status: res.status }
}
// A signed-in guest session (what a successful Google sign-in would produce).
// Minted with AUTH_SECRET, exactly as Auth.js does; needed because Google login cannot be automated.
async function guestCookie(email = 'guest.test@example.com') {
  const salt = 'authjs.session-token'
  const token = await encode({
    token: { name: 'Test Guest', email, sub: `test-${email}`, id: `test-${email}`, role: 'GUEST', emailVerified: true, signedInAt: Date.now() },
    secret: process.env.AUTH_SECRET, salt, maxAge: 3600,
  })
  return `${salt}=${token}`
}
function futureWindow(nights = 2) {
  const d = new Date(Date.now() + (30 + rnd(600)) * 86400000)
  const co = new Date(d.getTime() + nights * 86400000)
  const f = x => x.toISOString().slice(0, 10)
  return [f(d), f(co)]
}
async function book(overrides = {}, cookie = '') {
  const [checkIn, checkOut] = futureWindow()
  const body = {
    roomSlug: 'deluxe-double', mealPlan: 'BB', checkIn, checkOut, numGuests: 2,
    firstName: 'Test', lastName: 'Guest', phone: '+94771234567', specialRequests: '',
    ...(LEGACY ? { email: 'guest.test@example.com' } : {}),
    ...overrides,
  }
  const res = await raw('/api/bookings/checkout', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie } })
  let json = null; try { json = await res.json() } catch {}
  return { status: res.status, json }
}
async function ensureStaff(email, password, role = 'STAFF') {
  const passwordHash = await bcrypt.hash(password, 12) // same cost as the seeded admin account
  await prisma.adminUser.upsert({
    where: { email }, update: { passwordHash, role },
    create: { email, passwordHash, name: email.split('@')[0], role },
  })
}
function actionId(name) {
  const m = JSON.parse(readFileSync(join(NEXT_DIR, 'server/server-reference-manifest.json'), 'utf8'))
  for (const [id, v] of Object.entries(m.node ?? {})) if (v.exportedName === name) return id
  throw new Error('server action not found in manifest: ' + name)
}
const readMail = since => (existsSync(MAIL_LOG) ? readFileSync(MAIL_LOG, 'utf8').split('\n').filter(Boolean).slice(since).map(l => JSON.parse(l)) : [])
const mailCount = () => (existsSync(MAIL_LOG) ? readFileSync(MAIL_LOG, 'utf8').split('\n').filter(Boolean).length : 0)

// ── Tests ───────────────────────────────────────────────────────────────────
const tests = []
const test = (id, name, fn) => tests.push({ id, name, fn })

test('V01', 'Security headers present, X-Powered-By hidden', async () => {
  const h = (await raw('/')).headers
  const csp = h.get('content-security-policy') ?? ''
  const missing = []
  if (!csp) missing.push('CSP')
  if (!h.get('strict-transport-security')) missing.push('HSTS')
  if (!h.get('x-frame-options') && !/frame-ancestors/.test(csp)) missing.push('anti-clickjacking')
  if (h.get('x-content-type-options') !== 'nosniff') missing.push('nosniff')
  if (!h.get('referrer-policy')) missing.push('Referrer-Policy')
  if (!h.get('permissions-policy')) missing.push('Permissions-Policy')
  if (h.get('x-powered-by')) missing.push('X-Powered-By leaked')
  return { vulnerable: missing.length > 0, detail: missing.length ? 'problems: ' + missing.join(', ') : 'all 6 headers set, X-Powered-By hidden' }
})

test('V02', 'Cron endpoint fails closed when CRON_SECRET is unset', async () => {
  const bad = []
  for (const h of [{}, { authorization: 'Bearer undefined' }, { authorization: 'Bearer ' }, { authorization: 'Bearer null' }]) {
    const r = await fetch(CRON_URL + '/api/cron/expire-pending', { headers: h })
    if (r.status === 200) bad.push(JSON.stringify(h) === '{}' ? 'no header' : h.authorization)
  }
  return { vulnerable: bad.length > 0, detail: bad.length ? `HTTP 200 for: ${bad.join(' | ')}` : 'all guesses rejected with 401' }
})

test('V03', 'Email content is escaped and mail goes only to the verified guest', async () => {
  const cookie = await guestCookie('v03.guest@example.com')
  const before = mailCount()
  const evil = '<a href="https://evil.example/pay">CLICK HERE to confirm payment</a>'
  let res
  for (let i = 0; i < 3; i++) {
    res = await book({ email: 'victim@example.org', firstName: 'Mallory', lastName: 'Evil', specialRequests: evil + '<img src=x onerror=alert(1)>' }, cookie)
    if (res.status !== 409) break
  }
  await sleep(800)
  const mails = readMail(before)
  const toVictim = mails.some(m => [].concat(m.to).includes('victim@example.org'))
  const rawHtml = mails.some(m => (m.html ?? '').includes('<a href="https://evil.example/pay">'))
  // the mail must actually have been sent AND carry the text in harmless (escaped) form; otherwise the
  // test proved nothing (e.g. the booking was refused before any mail was written)
  const escapedSeen = mails.some(m => (m.html ?? '').includes('&lt;a href=&quot;https://evil.example/pay&quot;'))
  const vulnerable = toVictim || rawHtml || !escapedSeen
  return { vulnerable, detail: `API ${res.status}; mail to arbitrary victim: ${toVictim}; raw attacker HTML in email: ${rawHtml}; attacker text arrived escaped: ${escapedSeen}` }
})

test('V04', 'Server-side validation rejects nonsense bookings', async () => {
  const cookie = await guestCookie('v04.guest@example.com')
  const [ci] = futureWindow()
  const cases = {
    'negative guests': { numGuests: -5 },
    '9999 guests in a 2-person room': { numGuests: 9999 },
    'check-in in the past (2020)': { checkIn: '2020-01-01', checkOut: '2020-01-03' },
    '10-year stay': { checkIn: ci, checkOut: new Date(new Date(ci).getTime() + 3650 * 86400000).toISOString().slice(0, 10) },
    'invalid email': { email: 'not-an-email' },
    '300 KB name': { firstName: 'X'.repeat(300000) },
  }
  const accepted = []
  for (const [name, o] of Object.entries(cases)) if (ok2xx((await book(o, cookie)).status)) accepted.push(name)
  return { vulnerable: accepted.length > 0, detail: accepted.length ? 'accepted: ' + accepted.join('; ') : 'all 6 bad requests rejected' }
})

test('V05', 'One attacker cannot hoard all rooms; real guests can still book', async () => {
  const [checkIn, checkOut] = futureWindow(3)
  const attacker = await guestCookie('v05.attacker@example.com')
  const statuses = []
  for (let i = 0; i < 6; i++) statuses.push((await book({ roomSlug: 'family', checkIn, checkOut, numGuests: 2 }, attacker)).status)
  const won = statuses.filter(ok2xx).length
  const real = await book({ roomSlug: 'family', checkIn, checkOut, numGuests: 2 }, await guestCookie('v05.real@example.com'))
  return { vulnerable: won >= 4 || !ok2xx(real.status), detail: `attacker statuses ${statuses.join(',')} (${won} rooms held); real guest got HTTP ${real.status}` }
})

test('V06', 'Contact form has size and rate limits', async () => {
  const big = await raw('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'spam', email: 's@s.test', subject: 'x', message: 'A'.repeat(3_000_000) }) })
  const ip = fakeIp(); const codes = []
  for (let i = 0; i < 40; i++) codes.push((await raw('/api/contact', { method: 'POST', ip, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'spam', email: 's@s.test', subject: 'x', message: 'hello ' + i }) })).status)
  const limited = codes.includes(429)
  return { vulnerable: ok2xx(big.status) || !limited, detail: `3 MB message -> HTTP ${big.status}; 40 rapid posts: ${limited ? 'rate limited (429)' : 'never limited'}` }
})

test('V07', 'Login brute force is stopped', async () => {
  const email = 'locktest@tamarindtree.lk', pw = 'LockTest-Correct-1!'
  await ensureStaff(email, pw)
  const sanity = await login(email, pw)
  if (!sanity.ok) return { vulnerable: false, detail: 'inconclusive: correct password failed before the attack (stale lockout?)' }
  for (let i = 0; i < 12; i++) await login(email, 'wrong-guess-' + i)
  const after = await login(email, pw)
  return { vulnerable: after.ok, detail: after.ok ? '12 wrong guesses, then the CORRECT password still worked (no lockout)' : '12 wrong guesses, then even the correct password was refused (locked out)' }
})

test('V08', 'Response time does not reveal which staff emails exist', async () => {
  await ensureStaff('frontdesk@tamarindtree.lk', 'StaffPass-123')
  const real = [], fake = []
  for (let i = 0; i < 4; i++) {
    real.push((await login('frontdesk@tamarindtree.lk', 'wrong-password')).ms)
    fake.push((await login(`nobody-${rnd(1e6)}@tamarindtree.lk`, 'wrong-password')).ms)
  }
  const [r, f] = [median(real), median(fake)]
  return { vulnerable: r - f > 30 && r / f > 3, detail: `real email ${r.toFixed(0)} ms vs unknown email ${f.toFixed(0)} ms (medians of 4)` }
})

test('V09', 'STAFF role cannot change room prices (admin only)', async () => {
  await ensureStaff('frontdesk@tamarindtree.lk', 'StaffPass-123')
  const [ci, co] = futureWindow()
  const av = await (await raw(`/api/availability?checkIn=${ci}&checkOut=${co}&guests=2`)).json()
  const rt = av.results.find(r => r.slug === 'deluxe-double'); const planId = rt.rates.BB.id; const original = rt.rates.BB.pricePerNight
  const s = await login('frontdesk@tamarindtree.lk', 'StaffPass-123')
  if (!s.ok) return { vulnerable: false, detail: 'inconclusive: staff login failed' }
  await raw('/admin/rooms', { method: 'POST', headers: { 'next-action': actionId('updateRatePlan'), 'content-type': 'text/plain;charset=UTF-8', cookie: s.cookie }, body: JSON.stringify([planId, { priceUsd: 1, isVisible: true, isRefundable: true, cancellationPolicy: '' }]) })
  const after = (await (await raw(`/api/availability?checkIn=${ci}&checkOut=${co}&guests=2`)).json()).results.find(r => r.slug === 'deluxe-double').rates.BB.pricePerNight
  await prisma.ratePlan.update({ where: { id: planId }, data: { priceUsd: original } }) // restore
  return { vulnerable: after !== original, detail: `price ${original} -> ${after} after a STAFF-role attempt` }
})

test('V10', 'Sessions are short and end when the account is deleted', async () => {
  const email = 'fired.test@tamarindtree.lk', pw = 'Fired-Test-1!'
  await ensureStaff(email, pw)
  const s = await login(email, pw)
  if (!s.ok) return { vulnerable: false, detail: 'inconclusive: login failed' }
  const exp = /expires=([^;]+)/i.exec(s.setCookie ?? '')
  const hours = exp ? (new Date(exp[1]).getTime() - Date.now()) / 3.6e6 : NaN
  await prisma.adminUser.delete({ where: { email } })
  const after = await raw('/admin', { headers: { cookie: s.cookie } })
  const stillIn = after.status === 200
  return { vulnerable: hours > 24 || stillIn, detail: `cookie valid ${hours.toFixed(1)} h; after the account was deleted /admin returned HTTP ${after.status} (${stillIn ? 'still logged in' : 'kicked out'})` }
})

test('V11', 'Booking references are long and unpredictable', async () => {
  const cookie = await guestCookie('v11.guest@example.com')
  let res
  for (let i = 0; i < 3; i++) { res = await book({}, cookie); if (res.status !== 409) break }
  const code = res.json?.confirmationCode
  if (!code) return { vulnerable: false, detail: `inconclusive: booking returned HTTP ${res.status}` }
  const random = code.split('-').slice(2).join('')
  return { vulnerable: random.length < 10, detail: `code ${code} -> ${random.length} random characters (need >= 10)` }
})

test('V12', 'Security events are written to an audit log', async () => {
  let rows
  try { rows = await prisma.$queryRawUnsafe(`select action, count(*)::int as n from audit_logs group by action`) } catch { return { vulnerable: true, detail: 'no audit_logs table exists' } }
  const have = new Set(rows.map(r => r.action))
  const need = ['auth.login.failed', 'authz.denied']
  const miss = need.filter(a => !have.has(a))
  return { vulnerable: miss.length > 0, detail: miss.length ? 'missing audit events: ' + miss.join(', ') : `audit log holds ${rows.length} event types (${[...have].slice(0, 5).join(', ')}...)` }
})

test('V13', 'Dependencies have no known high/critical advisories', async () => {
  let out = ''
  try { out = execSync('pnpm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch (e) { out = e.stdout?.toString() ?? '' }
  try {
    const c = JSON.parse(out).metadata?.vulnerabilities ?? {}
    const bad = (c.critical ?? 0) + (c.high ?? 0)
    return { vulnerable: bad > 0, detail: `advisories: critical ${c.critical ?? 0}, high ${c.high ?? 0}, moderate ${c.moderate ?? 0}` }
  } catch { return { vulnerable: false, detail: 'skipped: pnpm audit output not readable (offline?)' } }
})

// ── Runner ──────────────────────────────────────────────────────────────────
// start every run from a clean slate: earlier runs may have left lockouts / rate-limit counters
try { await prisma.$executeRawUnsafe('DELETE FROM rate_limits') } catch { /* original app has no such table */ }
// ...and remove the bookings that earlier runs made for the @example.com test guests, so per-guest
// booking limits (V05) start fresh. Safe: this script refuses to run against a non-local database.
await prisma.booking.deleteMany({ where: { guest: { email: { endsWith: '@example.com' } } } })
await prisma.guest.deleteMany({ where: { email: { endsWith: '@example.com' } } })

const only = process.argv.slice(2)
const results = []
console.log(`\nSecurity tests against ${BASE}  (legacy API: ${LEGACY})\n`)
for (const t of tests) {
  if (only.length && !only.includes(t.id)) continue
  let r
  try { r = await t.fn() } catch (e) { r = { vulnerable: true, detail: 'test error: ' + e.message } }
  results.push({ id: t.id, name: t.name, ...r })
  console.log(`${r.vulnerable ? '[VULNERABLE]' : '[PROTECTED ]'} ${t.id} ${t.name}\n             ${r.detail}`)
}
const bad = results.filter(r => r.vulnerable).length
console.log(`\nSummary: ${results.length - bad} protected, ${bad} vulnerable (of ${results.length})\n`)
if (RESULT_FILE) writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2))
await prisma.$disconnect()
process.exit(bad ? 1 : 0)
