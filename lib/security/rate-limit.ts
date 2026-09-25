// Database-backed rate limiter (fixed window).
//
// Why the database and not a variable in memory? On Vercel every request can land on a different
// server instance, so an in-memory counter would let an attacker get "limit x number of instances".
// One atomic INSERT ... ON CONFLICT statement makes the counter safe under concurrent requests.
import { prisma } from '@/lib/db'

export type RateLimitResult = { allowed: boolean; count: number; limit: number; retryAfterSec: number }

const NOW_UTC = 'timezone(\'utc\', now())' // RateLimit.resetAt is stored as UTC without a zone

/** Count one hit for `key` and say whether it is still within `limit` hits per `windowSec` seconds. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const rows = await prisma.$queryRawUnsafe<{ count: number; secs: number }[]>(
    `INSERT INTO rate_limits ("key", "count", "resetAt")
     VALUES ($1, 1, ${NOW_UTC} + make_interval(secs => $2::double precision))
     ON CONFLICT ("key") DO UPDATE SET
       "count"   = CASE WHEN rate_limits."resetAt" <= ${NOW_UTC} THEN 1 ELSE rate_limits."count" + 1 END,
       "resetAt" = CASE WHEN rate_limits."resetAt" <= ${NOW_UTC} THEN ${NOW_UTC} + make_interval(secs => $2::double precision) ELSE rate_limits."resetAt" END
     RETURNING "count", EXTRACT(EPOCH FROM ("resetAt" - ${NOW_UTC}))::double precision AS secs`,
    key, windowSec,
  )
  const { count, secs } = rows[0]
  return { allowed: count <= limit, count, limit, retryAfterSec: Math.max(1, Math.ceil(secs)) }
}

/** Is `key` already over `limit`? Does not count a hit (used to check a lock before doing work). */
export async function isRateLimited(key: string, limit: number): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `SELECT "count" FROM rate_limits WHERE "key" = $1 AND "resetAt" > ${NOW_UTC}`, key,
  )
  return (rows[0]?.count ?? 0) >= limit
}

/** Forget a key (e.g. after a successful login). */
export async function clearRateLimit(...keys: string[]): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM rate_limits WHERE "key" = ANY($1::text[])`, keys)
}

/** Housekeeping: remove counters whose window ended more than an hour ago. Called by the daily cron. */
export async function purgeExpiredRateLimits(): Promise<number> {
  return prisma.$executeRawUnsafe(`DELETE FROM rate_limits WHERE "resetAt" < ${NOW_UTC} - interval '1 hour'`)
}
