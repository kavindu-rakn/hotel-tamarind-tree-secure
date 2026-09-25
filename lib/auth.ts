import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { rateLimit, isRateLimited, clearRateLimit } from '@/lib/security/rate-limit'
import { getClientIp } from '@/lib/security/client-ip'
import { audit } from '@/lib/security/audit'

// ─── Login protection (V07 brute force, V08 account guessing) ────────────────
// Failed attempts are counted three ways, each for LOGIN_WINDOW_SEC seconds:
//   per account            -> stops password guessing from many different IPs (distributed attack)
//   per IP + account       -> stops one machine hammering one account
//   per IP (any account)   -> stops one machine trying many accounts ("password spraying")
// Trade-off: an attacker can lock a real account for up to 15 minutes by failing on purpose. That is
// accepted: it is short, every lock is written to the audit log, and it is far better than letting
// them guess passwords for free.
const LOGIN_WINDOW_SEC = 15 * 60
const MAX_FAILS_PER_ACCOUNT = 10
const MAX_FAILS_PER_IP_AND_ACCOUNT = 5
const MAX_FAILS_PER_IP = 30

// ─── Session lifetime (V10) ──────────────────────────────────────────────────
const SESSION_IDLE_MAX_SEC     = 8 * 60 * 60
const SESSION_ABSOLUTE_MAX_MS  = 12 * 60 * 60 * 1000

// Guests (Google sign-in) have no account row in our database, so the only limit we can apply is time.
const GUEST_ABSOLUTE_MAX_MS    = 24 * 60 * 60 * 1000

// ─── Google sign-in for guests (OAuth 2.0 / OpenID Connect, Authorization Code flow) ─────────────
// Protections switched on for this flow:
//   PKCE (S256)  -> a stolen authorization code is useless without our one-time code_verifier
//   state        -> ties the callback to the browser that started the flow (login CSRF)
//   nonce        -> ties the ID token to this login attempt (replay of an old token)
//   The ID token's issuer, audience (our client id), expiry and nonce are checked by Auth.js.
//   Its signature is NOT checked: the token is fetched by our server straight from Google's token
//   endpoint over HTTPS, and OpenID Connect Core 3.1.3.7 allows TLS to stand in for the signature there.
//   That makes HTTPS to Google the thing we depend on, so the test-only issuer override below is
//   restricted to a local address and can never point at another server.
const googleIssuerOverride = process.env.AUTH_GOOGLE_ISSUER
if (googleIssuerOverride) {
  const loopbackOnly = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/.test(googleIssuerOverride)
  if (!loopbackOnly || process.env.VERCEL_ENV === 'production') {
    throw new Error('AUTH_GOOGLE_ISSUER is for local automated tests only (http://127.0.0.1:PORT) and must never be set in production')
  }
}

// A throw-away bcrypt hash (cost 12, same as real accounts) of a random string nobody knows, made once per
// server instance. Compared against when the email does not exist, so unknown and known emails take the
// same time (V08). It is created at run time on purpose: a hash written into the source code looks like a
// leaked credential to secret scanners (Semgrep flagged the earlier version) and has to be explained every time.
let dummyHashPromise: Promise<string> | undefined
const dummyPasswordHash = () => (dummyHashPromise ??= bcrypt.hash(randomBytes(32).toString('hex'), 12))

const credentialsSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
})

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId:     process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      checks: ['pkce', 'state', 'nonce'],
      authorization: { params: { scope: 'openid email profile', prompt: 'select_account' } },
      ...(googleIssuerOverride ? { issuer: googleIssuerOverride } : {}),
    }),
    Credentials({
      name: 'Staff Login',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) return null

        const email = parsed.data.email.toLowerCase()
        const { password } = parsed.data
        const ip = getClientIp(request.headers)
        const userAgent = request.headers.get('user-agent')

        const dummyHash = await dummyPasswordHash() // (first call per instance builds it; later calls are instant)

        const kAccount = `login:acct:${email}`
        const kPair    = `login:pair:${ip}:${email}`
        const kIp      = `login:ip:${ip}`

        // 1. Is this account / IP currently locked? Same generic failure and same time as a wrong password.
        const locked =
          (await isRateLimited(kAccount, MAX_FAILS_PER_ACCOUNT)) ||
          (await isRateLimited(kPair, MAX_FAILS_PER_IP_AND_ACCOUNT)) ||
          (await isRateLimited(kIp, MAX_FAILS_PER_IP))
        if (locked) {
          await bcrypt.compare(password, dummyHash)
          await audit({ action: 'auth.login.locked', outcome: 'denied', actorEmail: email, ip, userAgent })
          return null
        }

        // 2. Look the account up. ALWAYS run exactly one bcrypt comparison, even when the email is unknown,
        //    so response time does not reveal which emails exist (V08).
        const user = await prisma.adminUser.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
        })
        const passwordMatch = await bcrypt.compare(password, user?.passwordHash ?? dummyHash)

        if (!user || !passwordMatch) {
          await Promise.all([
            rateLimit(kAccount, MAX_FAILS_PER_ACCOUNT, LOGIN_WINDOW_SEC),
            rateLimit(kPair, MAX_FAILS_PER_IP_AND_ACCOUNT, LOGIN_WINDOW_SEC),
            rateLimit(kIp, MAX_FAILS_PER_IP, LOGIN_WINDOW_SEC),
          ])
          await audit({
            action: 'auth.login.failed', outcome: 'failure', actorEmail: email, ip, userAgent,
            metadata: { reason: user ? 'bad_password' : 'unknown_account' },
          })
          return null
        }

        // 3. Success: forget the failure counters for this account and record the login
        await clearRateLimit(kAccount, kPair)
        await prisma.adminUser.update({
          where: { id: user.id },
          data:  { lastLogin: new Date() },
        })
        await audit({
          action: 'auth.login.success', outcome: 'success',
          actorId: user.id, actorEmail: user.email, actorRole: user.role, ip, userAgent,
        })

        return {
          id:    user.id,
          email: user.email,
          name:  user.name,
          role:  user.role,
        }
      },
    }),
  ],

  callbacks: {
    // Runs when someone finishes a sign-in. For Google we only accept an email address that Google
    // itself says is verified: otherwise a person could register a Google account with somebody
    // else's address and receive that person's booking emails.
    async signIn({ account, profile }) {
      if (account?.provider === 'google') {
        return profile?.email_verified === true && typeof profile.email === 'string'
      }
      return true
    },

    async jwt({ token, user, account, profile }) {
      // Sign-in with Google: this person is ALWAYS a guest, whatever their email address is.
      // (Staff roles come only from our own admin_users table through the Credentials provider below.)
      if (account?.provider === 'google' && profile) {
        return {
          sub:        `google:${profile.sub}`,
          id:         `google:${profile.sub}`,
          name:       profile.name ?? null,
          email:      (profile.email as string).toLowerCase(),
          picture:    profile.picture ?? null,
          role:       'GUEST',
          signedInAt: Date.now(),
        }
      }

      // Sign-in moment for staff: remember who they are and when they signed in
      if (user) {
        token.id         = user.id
        token.role       = (user as { role?: string }).role
        token.signedInAt = Date.now()
        return token
      }

      // Every later request, guests: hard time limit only (there is no account row to re-check)
      if (token.role === 'GUEST') {
        if (Date.now() - (token.signedInAt ?? 0) > GUEST_ABSOLUTE_MAX_MS) return null
        return token
      }

      // Every later request, staff (V10): a staff session is only as good as the staff ACCOUNT behind it.
      // The original trusted the cookie for 30 days even after the account was deleted or demoted.
      if (token.role === 'ADMIN' || token.role === 'STAFF') {
        // hard ceiling: nobody stays signed in more than 12 hours, however active they are
        // (tokens without signedInAt, e.g. issued before this fix, are treated as expired)
        if (Date.now() - (token.signedInAt ?? 0) > SESSION_ABSOLUTE_MAX_MS) return null

        // the account must still exist, and the role is re-read so a demotion applies immediately
        const current = await prisma.adminUser.findUnique({
          where:  { id: token.id as string },
          select: { role: true },
        })
        if (!current) return null // returning null makes Auth.js end the session and clear the cookie
        token.role = current.role
        return token
      }

      // Any other role value is not something we ever issue: end the session.
      return null
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id   = token.id as string
        session.user.role = token.role as string
      }
      return session
    },
  },

  pages: {
    signIn: '/admin/login', // staff password login (also where wrong-password errors land)
    error:  '/sign-in',     // guest / Google sign-in errors
  },

  // Idle timeout 8 hours (cookie is refreshed while the person keeps working), absolute limit 12 hours
  // (enforced in the jwt callback). The original allowed 30 days.
  session: { strategy: 'jwt', maxAge: SESSION_IDLE_MAX_SEC, updateAge: 15 * 60 },

  // No `trustHost: true` any more: it told Auth.js to believe whatever Host header a request carried.
  // The site address now comes from AUTH_URL (or from Vercel itself when deployed there).
})

// Augment next-auth types
declare module 'next-auth' {
  interface User {
    role?: string
  }
  interface Session {
    user: {
      id:    string
      email: string
      name:  string
      role:  string
    }
  }
}
