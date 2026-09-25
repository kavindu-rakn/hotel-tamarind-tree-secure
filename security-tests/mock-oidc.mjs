// security-tests/mock-oidc.mjs
// A tiny FAKE "Google" (OpenID Connect provider) used ONLY by the automated tests.
// Real Google sign-in needs a human clicking in a browser; this lets a script play both sides so we can
// prove that OUR app checks what it must check: PKCE, state, nonce, signature, audience, verified email.
//
// The fake is deliberately strict about PKCE: it refuses to hand out tokens unless the app proves it knows
// the secret code_verifier that matches the code_challenge sent at the start.
import http from 'node:http'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const b64u = buf => Buffer.from(buf).toString('base64url')

export function startMockOidc({ port = 4020, clientId, clientSecret }) {
  const issuer = `http://127.0.0.1:${port}`
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const { publicKey: otherPub, privateKey: otherPriv } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const kid = 'test-key-1'
  const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] }

  // What the next sign-in will look like. Tests change it through /__identity.
  let identity = { sub: '1000000001', email: 'guest.one@example.com', email_verified: true, name: 'Guest One', picture: '' }
  // Ways to misbehave (each test switches one on, then off):
  let tamper = { nonce: false, aud: false, badSignature: false, iss: false, expired: false }

  const codes = new Map() // code -> { challenge, method, nonce, redirectUri, identity, used }
  const tokenRequests = [] // what the app sent to /token, so tests can check code_verifier was sent

  function signIdToken(claims, key = privateKey) {
    const header = { alg: 'RS256', typ: 'JWT', kid }
    const data = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`
    const sig = crypto.sign('RSA-SHA256', Buffer.from(data), key)
    return `${data}.${b64u(sig)}`
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer)
    const send = (status, obj, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
      res.end(JSON.stringify(obj))
    }

    if (url.pathname === '/.well-known/openid-configuration') {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`, // Auth.js insists the discovery document lists one (Google's does)
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        scopes_supported: ['openid', 'email', 'profile'],
      })
    }
    if (url.pathname === '/jwks') return send(200, jwks)
    if (url.pathname === '/userinfo') return send(401, { error: 'not_used' }) // profile comes from the signed ID token

    // ── test control ────────────────────────────────────────────────
    if (url.pathname === '/__identity') {
      const q = Object.fromEntries(url.searchParams)
      identity = {
        sub: q.sub ?? '1000000001',
        email: q.email ?? 'guest.one@example.com',
        email_verified: q.verified !== 'false',
        name: q.name ?? 'Guest One',
        picture: '',
      }
      tamper = { nonce: q.tamper === 'nonce', aud: q.tamper === 'aud', badSignature: q.tamper === 'signature', iss: q.tamper === 'iss', expired: q.tamper === 'expired' }
      return send(200, { ok: true, identity, tamper })
    }
    if (url.pathname === '/__token-requests') return send(200, tokenRequests)

    // ── step 1: the browser arrives here from our app ───────────────
    if (url.pathname === '/authorize') {
      const p = Object.fromEntries(url.searchParams)
      if (p.client_id !== clientId) return send(400, { error: 'unauthorized_client' })
      if (p.response_type !== 'code') return send(400, { error: 'unsupported_response_type' })
      const code = crypto.randomBytes(16).toString('hex')
      codes.set(code, {
        challenge: p.code_challenge, method: p.code_challenge_method, nonce: p.nonce,
        redirectUri: p.redirect_uri, identity: { ...identity }, tamper: { ...tamper }, used: false,
      })
      const back = new URL(p.redirect_uri)
      back.searchParams.set('code', code)
      if (p.state) back.searchParams.set('state', p.state)
      back.searchParams.set('iss', issuer)
      res.writeHead(302, { location: back.toString() })
      return res.end()
    }

    // ── step 2: our server swaps the code for tokens ─────────────────
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = ''
      for await (const c of req) raw += c
      const f = Object.fromEntries(new URLSearchParams(raw))
      let cid = f.client_id, csec = f.client_secret
      const basic = req.headers.authorization?.match(/^Basic (.+)$/i)
      if (basic) [cid, csec] = Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent)

      tokenRequests.push({
        grant_type: f.grant_type,
        has_code_verifier: Boolean(f.code_verifier),
        client_auth: basic ? 'basic' : f.client_secret ? 'post' : 'none',
        client_id_ok: cid === clientId,
        secret_ok: csec === clientSecret,
      })

      if (cid !== clientId || csec !== clientSecret) return send(401, { error: 'invalid_client' })
      const c = codes.get(f.code)
      if (!c || c.used) return send(400, { error: 'invalid_grant', error_description: 'code unknown or already used' })
      c.used = true
      if (c.redirectUri !== f.redirect_uri) return send(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' })
      // PKCE: sha256(verifier) must equal the challenge from step 1
      if (!c.challenge || c.method !== 'S256') return send(400, { error: 'invalid_request', error_description: 'PKCE required' })
      const expected = crypto.createHash('sha256').update(f.code_verifier ?? '').digest('base64url')
      if (expected !== c.challenge) return send(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' })

      const now = Math.floor(Date.now() / 1000)
      const claims = {
        iss: c.tamper.iss ? 'https://evil.example' : issuer,
        aud: c.tamper.aud ? 'someone-elses-client-id' : clientId,
        sub: c.identity.sub,
        email: c.identity.email,
        email_verified: c.identity.email_verified,
        name: c.identity.name,
        picture: c.identity.picture,
        nonce: c.tamper.nonce ? 'not-the-nonce-we-sent' : c.nonce,
        iat: now,
        exp: c.tamper.expired ? now - 3600 : now + 3600,
      }
      const id_token = signIdToken(claims, c.tamper.badSignature ? otherPriv : privateKey)
      return send(200, { access_token: crypto.randomBytes(16).toString('hex'), token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile', id_token })
    }

    send(404, { error: 'not_found' })
  })

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ issuer, server, close: () => server.close() })))
}

// run directly:  node security-tests/mock-oidc.mjs  (keeps running)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.MOCK_OIDC_PORT ?? 4020)
  await startMockOidc({ port, clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })
  console.log(`mock OIDC provider listening on http://127.0.0.1:${port}`)
}
