import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
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
    jwt({ token, user }) {
      if (user) {
        token.id   = user.id
        token.role = (user as { role?: string }).role
      }
      return token
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
    signIn: '/admin/login',
    error:  '/admin/login',
  },

  session: { strategy: 'jwt' },

  trustHost: true,
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
