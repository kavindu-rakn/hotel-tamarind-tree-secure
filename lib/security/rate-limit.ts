// Database-backed rate limiter (fixed window).
//
// Why the database and not a variable in memory? On Vercel every request can land on a different
// server instance, so an in-memory counter would let an attacker get "limit x number of instances".
// One atomic INSERT ... ON CONFLICT statement makes the counter safe under concurrent requests.
import { prisma } from '@/lib/db'

export type RateLimitResult = { allowed: boolean; count: number; limit: number; retryAfterSec: number }

// All queries below use Prisma's tagged-template form: every ${value} is sent to the database as a bound
// parameter, never pasted into the SQL text, so nothing a visitor controls can change the query (SQL injection).
// RateLimit.resetAt is stored as UTC without a zone, hence timezone('utc', now()) everywhere.

/** Count one hit for `key` and say whether it is still within `limit` hits per `windowSec` seconds. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const rows = await prisma.$queryRaw<{ count: number; secs: number }[]>`
    INSERT INTO rate_limits ("key", "count", "resetAt")
    VALUES (${key}, 1, timezone('utc', now()) + make_interval(secs => ${windowSec}::double precision))
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN rate_limits."resetAt" <= timezone('utc', now()) THEN 1 ELSE rate_limits."count" + 1 END,
      "resetAt" = CASE WHEN rate_limits."resetAt" <= timezone('utc', now())
                       THEN timezone('utc', now()) + make_interval(secs => ${windowSec}::double precision)
                       ELSE rate_limits."resetAt" END
    RETURNING "count", EXTRACT(EPOCH FROM ("resetAt" - timezone('utc', now())))::double precision AS secs`
  const { count, secs } = rows[0]
  return { allowed: count <= limit, count, limit, retryAfterSec: Math.max(1, Math.ceil(secs)) }
}

/** Is `key` already over `limit`? Does not count a hit (used to check a lock before doing work). */
export async function isRateLimited(key: string, limit: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT "count" FROM rate_limits WHERE "key" = ${key} AND "resetAt" > timezone('utc', now())`
  return (rows[0]?.count ?? 0) >= limit
}

/** Forget a key (e.g. after a successful login). */
export async function clearRateLimit(...keys: string[]): Promise<void> {
  await prisma.$executeRaw`DELETE FROM rate_limits WHERE "key" = ANY(${keys}::text[])`
}

/** Housekeeping: remove counters whose window ended more than an hour ago. Called by the daily cron. */
export async function purgeExpiredRateLimits(): Promise<number> {
  return prisma.$executeRaw`DELETE FROM rate_limits WHERE "resetAt" < timezone('utc', now()) - interval '1 hour'`
}
