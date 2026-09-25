// app/api/cron/expire-pending/route.ts
// Cancels PENDING booking requests that have sat unanswered past
// PENDING_REQUEST_EXPIRY_HOURS, freeing the room unit back up.
// Triggered by Vercel Cron (see vercel.json) — protected via CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PENDING_REQUEST_EXPIRY_HOURS } from '@/lib/constants'
import { safeEqual } from '@/lib/security/safe-compare'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET

  // V02: fail CLOSED. The original compared against `Bearer ${process.env.CRON_SECRET}`, so when the
  // variable was missing the expected value became the string "Bearer undefined" and anyone who sent
  // that header was let in. Now a missing or weak secret means nobody gets in.
  if (!secret || secret.length < 16) {
    console.error('[cron] CRON_SECRET is missing or shorter than 16 characters - refusing every request')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Constant-time comparison so response time cannot be used to guess the secret one character at a time.
  const authHeader = req.headers.get('authorization') ?? ''
  if (!safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - PENDING_REQUEST_EXPIRY_HOURS * 60 * 60 * 1000)

  const { count } = await db.booking.updateMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: cutoff },
    },
    data: {
      status: 'CANCELLED',
      cancellationReason: `Auto-expired — no staff response within ${PENDING_REQUEST_EXPIRY_HOURS}h`,
    },
  })

  return NextResponse.json({ expired: count })
}
