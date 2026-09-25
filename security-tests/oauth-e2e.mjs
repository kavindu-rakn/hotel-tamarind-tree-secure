// security-tests/oauth-e2e.mjs
// End-to-end check of the "Sign in with Google" feature WITHOUT a real Google account.
// A fake Google (security-tests/mock-oidc.mjs) runs on :4020 and this script plays the browser.
//
// The app under test must be started with:
//     AUTH_GOOGLE_ISSUER=http://127.0.0.1:4020  AUTH_URL=http://localhost:3003   (tools/restart-fixed.sh does this on :3003)
//
// usage:  node security-tests/oauth-e2e.mjs
import { existsSync } from 'node:fs'
import { startMockOidc } from './mock-oidc.mjs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const BASE = process.env.OAUTH_BASE ?? 'http://localhost:3003'
const MOCK_PORT = Number(process.env.MOCK_OIDC_PORT ?? 4020)
const clientId = process.env.AUTH_GOOGLE_ID
const clientSecret = process.env.AUTH_GOOGLE_SECRET
if (!clientId || !clientSecret) { console.error('AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET missing (any dummy values are fine)'); process.exit(2) }

const mock = await startMockOidc({ port: MOCK_PORT, clientId, clientSecret })
const setIdentity = async (o = {}) => (await fetch(`${mock.issuer}/__identity?` + new URLSearchParams(o))).json()
const tokenRequests = async () => (await fetch(`${mock.issuer}/__token-requests`)).json()

// ── a very small cookie jar ────────────────────────────────────────────────
class Jar {
  constructor(m) { this.m = new Map(m) }
  clone() { return new Jar(this.m) }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join('; ') }
  absorb(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';')
      const i = pair.indexOf('=')
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim()
      const dead = value === '' || attrs.some(a => /^\s*max-age=0/i.test(a)) || attrs.some(a => /^\s*expires=/i.test(a) && new Date(a.split('=')[1]) < new Date())
      dead ? this.m.delete(name) : this.m.set(name, value)
    }
  }
  has(part) { return [...this.m.keys()].some(k => k.includes(part)) }
}
const get = (jar, path, init = {}) => fetch(path.startsWith('http') ? path : BASE + path, { redirect: 'manual', ...init, headers: { cookie: jar.header(), ...(init.headers ?? {}) } })
  .then(r => { jar.absorb(r); return r })

/** Walk the whole Google sign-in as a browser would. Returns everything the checks need. */
async function googleSignIn({ identity = {}, mutateCallback } = {}) {
  await setIdentity(identity)
  const jar = new Jar()
  const csrf = (await (await get(jar, '/api/auth/csrf')).json()).csrfToken

  // 1. our app -> redirect to (fake) Google
  const r1 = await get(jar, '/api/auth/signin/google', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: csrf, callbackUrl: `${BASE}/book` }),
  })
  const authUrl = new URL(r1.headers.get('location'))

  // 2. "the user logs in at Google" -> Google redirects back with ?code&state
  const r2 = await fetch(authUrl, { redirect: 'manual' })
  let back = new URL(r2.headers.get('location'))
  const beforeCallback = jar.clone() // what an attacker replaying the callback would still hold
  if (mutateCallback) back = mutateCallback(back)

  // 3. the browser delivers the code to our callback
  const r3 = await get(jar, back.toString())
  const loc = r3.headers.get('location') ?? ''
  const session = await (await get(jar, '/api/auth/session')).json().catch(() => null)
  return { jar, authUrl, backUrl: back, beforeCallback, callbackStatus: r3.status, callbackLocation: loc, session, hasSessionCookie: jar.has('session-token') }
}

// ── checks ─────────────────────────────────────────────────────────────────
const results = []
const check = (name, pass, detail) => { results.push({ name, pass }); console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}\n       ${detail}`) }

console.log(`\nGoogle sign-in end-to-end tests against ${BASE} (fake Google on ${mock.issuer})\n`)

// A. the happy path
{
  const a = await googleSignIn({ identity: { email: 'Guest.One@Example.com', sub: '1000000001', name: 'Guest One' } })
  const q = a.authUrl.searchParams
  check('Authorization request uses Authorization Code flow with PKCE (S256), state and nonce',
    q.get('response_type') === 'code' && q.get('code_challenge_method') === 'S256' && q.get('code_challenge')?.length >= 43 && !!q.get('state') && !!q.get('nonce'),
    `response_type=${q.get('response_type')} method=${q.get('code_challenge_method')} challenge=${q.get('code_challenge')?.length} chars state=${!!q.get('state')} nonce=${!!q.get('nonce')}`)
  check('The client secret is never sent to the browser', !a.authUrl.toString().includes(clientSecret), 'client_secret not present in the redirect URL')
  const tr = (await tokenRequests()).at(-1)
  check('App proves itself to Google with the PKCE code_verifier when exchanging the code', tr?.has_code_verifier === true && tr.grant_type === 'authorization_code', `token request: ${JSON.stringify(tr)}`)
  check('A verified Google login creates a GUEST session with the verified, lower-cased email',
    a.hasSessionCookie && a.session?.user?.email === 'guest.one@example.com' && a.session?.user?.role === 'GUEST',
    `session user = ${JSON.stringify(a.session?.user)}`)
  check('Login returns the person to the page they came from', a.callbackLocation.replace(BASE, '').startsWith('/book'), `redirect -> ${a.callbackLocation}`)

  const admin = await get(a.jar, '/admin')
  const adminRooms = await get(a.jar, '/admin/rooms')
  const adminApi = await get(a.jar, '/api/admin/whatever')
  check('A guest session cannot open the staff console',
    admin.status !== 200 && adminRooms.status !== 200 && adminApi.status === 401,
    `/admin -> ${admin.status}, /admin/rooms -> ${adminRooms.status}, /api/admin/* -> ${adminApi.status}`)

  // cookie tampering
  const tampered = a.jar.clone()
  const name = [...tampered.m.keys()].find(k => k.includes('session-token'))
  const val = tampered.m.get(name)
  tampered.m.set(name, val.slice(0, -4) + (val.endsWith('AAAA') ? 'BBBB' : 'AAAA'))
  const ts = await (await get(tampered, '/api/auth/session')).json().catch(() => null)
  check('A tampered session cookie is rejected', !ts?.user, `session with edited cookie = ${JSON.stringify(ts)}`)

  // sign out
  const csrf2 = (await (await get(a.jar, '/api/auth/csrf')).json()).csrfToken
  await get(a.jar, '/api/auth/signout', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken: csrf2 }) })
  const after = await (await get(a.jar, '/api/auth/session')).json().catch(() => null)
  check('Signing out ends the session', !after?.user, `session after sign-out = ${JSON.stringify(after)}`)
}

// B. privilege confusion: a Google account that uses a STAFF email address is still only a guest
{
  const b = await googleSignIn({ identity: { email: 'admin@tamarindtree.lk', sub: '2000000002', name: 'Not The Admin' } })
  const admin = await get(b.jar, '/admin')
  check('A Google account with a staff email address is still only a GUEST (no privilege escalation)',
    b.session?.user?.role === 'GUEST' && admin.status !== 200,
    `role = ${b.session?.user?.role}, /admin -> ${admin.status}`)
}

// C. attacks on the sign-in itself
async function mustFail(name, opts) {
  const r = await googleSignIn(opts)
  check(name, !r.hasSessionCookie && !r.session?.user && r.callbackLocation.includes('/sign-in'),
    `session cookie: ${r.hasSessionCookie}, user: ${JSON.stringify(r.session?.user ?? null)}, redirect -> ${r.callbackLocation.replace(BASE, '')}`)
  return r
}
await mustFail('Email that Google has NOT verified is refused', { identity: { email: 'someone.else@example.com', verified: 'false' } })
await mustFail('Callback with a forged "state" is refused (login CSRF)', {
  identity: { email: 'csrf@example.com' },
  mutateCallback: u => { u.searchParams.set('state', u.searchParams.get('state').slice(0, -3) + 'xyz'); return u },
})
await mustFail('Callback with no "state" is refused', { identity: { email: 'nostate@example.com' }, mutateCallback: u => { u.searchParams.delete('state'); return u } })
await mustFail('ID token with the wrong nonce is refused (token replay)', { identity: { email: 'n@example.com', tamper: 'nonce' } })
await mustFail('ID token issued for another application (wrong audience) is refused', { identity: { email: 'a@example.com', tamper: 'aud' } })
await mustFail('ID token from a different issuer is refused', { identity: { email: 'i@example.com', tamper: 'iss' } })
await mustFail('Expired ID token is refused', { identity: { email: 'e@example.com', tamper: 'expired' } })

// D. replaying an authorization code
{
  const first = await googleSignIn({ identity: { email: 'replay@example.com' } })
  const replayJar = first.beforeCallback.clone()
  const r = await get(replayJar, first.backUrl.toString())
  check('An authorization code cannot be used twice', !replayJar.has('session-token'), `replayed callback -> ${r.status} ${(r.headers.get('location') ?? '').replace(BASE, '')}, session cookie: ${replayJar.has('session-token')}`)
}

// E. open redirect through the sign-in page (the page sends a signed-in guest back to ?callbackUrl)
{
  const g = await googleSignIn({ identity: { email: 'redirect@example.com' } })
  const bad = ['https://evil.example/steal', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'https:evil.example']
  const seen = []
  for (const u of bad) {
    const r = await get(g.jar, '/sign-in?callbackUrl=' + encodeURIComponent(u))
    seen.push(`${u} -> ${(r.headers.get('location') ?? '(none)').replace(BASE, '')}`)
  }
  const good = await get(g.jar, '/sign-in?callbackUrl=' + encodeURIComponent('/account'))
  check('The sign-in page only ever redirects to pages on this site (open redirect)',
    seen.every(s => !/evil|javascript/.test(s.split(' -> ')[1])) && good.headers.get('location')?.endsWith('/account'),
    seen.join(' | ') + ` | /account -> ${good.headers.get('location')?.replace(BASE, '')}`)
}

mock.close()
const failed = results.filter(r => !r.pass).length
console.log(`\nSummary: ${results.length - failed} passed, ${failed} failed (of ${results.length})\n`)
process.exit(failed ? 1 : 0)
