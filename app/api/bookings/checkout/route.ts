// app/api/bookings/checkout/route.ts
// Payment-free "Request to Book" flow.
// Creates a PENDING booking in the DB and sends notification emails.
// PayHere payment integration will be added in a later phase.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getResend, FROM_EMAIL, HOTEL_EMAIL } from '@/lib/resend'
import {
  generateConfirmationCode,
  assignAvailableUnit,
  countNights,
  guestConfirmationEmailHtml,
  staffNotificationEmailHtml,
} from '@/lib/booking-utils'
import { urlSlugToEnum } from '@/lib/utils'
import { getGuest } from '@/lib/security/guest'
import { crossSiteBlock, readJsonBody } from '@/lib/security/request'
import { bookingRequestSchema, todayAtHotel } from '@/lib/validation/booking'
import { rateLimit } from '@/lib/security/rate-limit'
import { getClientIp } from '@/lib/security/client-ip'
import { audit } from '@/lib/security/audit'

// A real booking request is well under 1 KB. 8 KB leaves generous room and still stops abuse.
const MAX_BODY_BYTES = 8 * 1024

// ─── Anti-hoarding (V05) ─────────────────────────────────────────────────────
// A PENDING request blocks the room for everybody else until staff answer or it expires (48 h). The
// original let one anonymous script request every room in the hotel in seconds, for free.
//   - one guest may have at most 3 requests waiting for confirmation at a time (a family booking 2-3 rooms is fine)
//   - at most 10 attempts per guest and 20 per network address per hour
// Trade-off: someone with many Google accounts can still hold rooms, only more slowly and at a visible
// cost (each request is tied to a verified email, is audited, and expires). The complete fix is a
// deposit at booking time, which needs the payment feature that this project does not have yet.
const MAX_PENDING_PER_GUEST = 3
const MAX_ATTEMPTS_PER_GUEST_PER_HOUR = 10
const MAX_ATTEMPTS_PER_IP_PER_HOUR = 20

function tooMany(message: string, retryAfterSec?: number) {
  return NextResponse.json({ error: message }, {
    status: 429,
    headers: retryAfterSec ? { 'Retry-After': String(retryAfterSec) } : undefined,
  })
}

async function countPendingRequests(email: string) {
  return db.booking.count({
    where: {
      status: 'PENDING',
      checkOut: { gte: new Date(`${todayAtHotel()}T00:00:00Z`) }, // old, forgotten requests do not count
      guest: { email },
    },
  })
}

// Postgres exclusion-constraint violation (23P01) — thrown when two
// concurrent requests race for the same room unit + date range. Prisma
// doesn't have a known error code for EXCLUDE constraints, so we match
// on the constraint name in the underlying error message.
function isOverlapConflict(err: unknown): boolean {
  return err instanceof Error && err.message.includes('bookings_no_overlap_excl')
}

async function createBookingWithRetry(params: {
  roomTypeId: string
  checkInDate: Date
  checkOutDate: Date
  guestId: string
  ratePlanId: string
  numGuests: number
  totalUsd: number
  specialRequests: string | null
}, maxAttempts = 5) {
  const { roomTypeId, checkInDate, checkOutDate, ...rest } = params
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const unitId = await assignAvailableUnit(roomTypeId, checkInDate, checkOutDate)
    if (!unitId) return null

    try {
      return await db.booking.create({
        data: {
          confirmationCode: generateConfirmationCode(),
          roomUnitId:       unitId,
          guestId:          rest.guestId,
          ratePlanId:       rest.ratePlanId,
          checkIn:          checkInDate,
          checkOut:         checkOutDate,
          numGuests:        rest.numGuests,
          status:           'PENDING',
          totalPriceUsd:    rest.totalUsd,
          paymentStatus:    'UNPAID',
          specialRequests:  rest.specialRequests,
        },
      })
    } catch (err) {
      if (isOverlapConflict(err)) continue // another request took this unit — retry with fresh availability
      throw err
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    // 1. Only our own pages may post here (blocks another website acting as a signed-in guest)
    const blocked = crossSiteBlock(req)
    if (blocked) return blocked

    // 2. V03 (part 1): only a guest who signed in with Google may book, and the confirmation goes to the
    //    email address GOOGLE verified. The original took `email` from the request body, so anyone could
    //    make the hotel's mail server send messages to any address they liked.
    const sessionGuest = await getGuest()
    if (!sessionGuest) {
      return NextResponse.json({ error: 'Please sign in with Google to make a booking request.' }, { status: 401 })
    }
    const email = sessionGuest.email
    const ip = getClientIp(req.headers)
    const userAgent = req.headers.get('user-agent')

    // 2b. V05: rate limits per guest and per network address (the IP limit is skipped only when the
    //     address cannot be determined; the per-guest limit still applies then)
    const perGuest = await rateLimit(`book:guest:${sessionGuest.id}`, MAX_ATTEMPTS_PER_GUEST_PER_HOUR, 3600)
    const perIp = ip === 'unknown' ? null : await rateLimit(`book:ip:${ip}`, MAX_ATTEMPTS_PER_IP_PER_HOUR, 3600)
    if (!perGuest.allowed || (perIp && !perIp.allowed)) {
      await audit({ action: 'booking.request.rate_limited', outcome: 'denied', actorId: sessionGuest.id, actorEmail: email, actorRole: 'GUEST', ip, userAgent })
      return tooMany('Too many booking attempts. Please try again later.', Math.max(perGuest.retryAfterSec, perIp?.retryAfterSec ?? 0))
    }

    // 3. V04: read a bounded body and validate every field. Unknown fields are rejected outright.
    const read = await readJsonBody(req, MAX_BODY_BYTES)
    if (!read.ok) return read.response
    const parsed = bookingRequestSchema.safeParse(read.data)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return NextResponse.json(
        { error: first?.message ?? 'Please check your details.', field: first?.path?.[0] ?? null },
        { status: 400 },
      )
    }
    const { roomSlug, mealPlan, checkIn, checkOut, numGuests, firstName, lastName, phone, specialRequests } = parsed.data

    const enumSlug = urlSlugToEnum(roomSlug)
    if (!enumSlug) {
      return NextResponse.json({ error: 'Unknown room.' }, { status: 400 })
    }

    const checkInDate  = new Date(`${checkIn}T00:00:00Z`)
    const checkOutDate = new Date(`${checkOut}T00:00:00Z`)
    const nights       = countNights(checkInDate, checkOutDate)

    // ── Fetch room type + rate plan ───────────────────────────────
    const roomType = await db.roomType.findUnique({ where: { slug: enumSlug } })
    if (!roomType) return NextResponse.json({ error: 'Room type not found' }, { status: 404 })
    if (numGuests > roomType.maxOccupancy) {
      return NextResponse.json(
        { error: `${roomType.displayName} sleeps up to ${roomType.maxOccupancy} guests.`, field: 'numGuests' },
        { status: 400 },
      )
    }

    const ratePlan = await db.ratePlan.findFirst({
      where: { roomTypeId: roomType.id, mealPlan, isVisible: true },
    })
    if (!ratePlan) return NextResponse.json({ error: 'Rate plan not found' }, { status: 404 })

    // ── Create or find guest ──────────────────────────────────────
    const guestName = `${firstName.trim()} ${lastName.trim()}`
    let guest = await db.guest.findFirst({ where: { email } })
    if (!guest) {
      guest = await db.guest.create({
        data: { name: guestName, email, phone: phone || null },
      })
    }

    // ── V05: how many requests is this guest already holding? ───────
    if ((await countPendingRequests(email)) >= MAX_PENDING_PER_GUEST) {
      await audit({ action: 'booking.request.pending_cap', outcome: 'denied', actorId: sessionGuest.id, actorEmail: email, actorRole: 'GUEST', ip, userAgent })
      return tooMany(`You already have ${MAX_PENDING_PER_GUEST} booking requests waiting for confirmation. Please wait for the hotel to reply, or contact us if you need more rooms.`)
    }

    // ── Calculate total ───────────────────────────────────────────
    const pricePerNight = Number(ratePlan.priceUsd)
    const totalUsd      = pricePerNight * nights

    // ── Assign a unit + create PENDING booking (retry on race) ─────
    const booking = await createBookingWithRetry({
      roomTypeId:      roomType.id,
      checkInDate,
      checkOutDate,
      guestId:         guest.id,
      ratePlanId:      ratePlan.id,
      numGuests,
      totalUsd,
      specialRequests: specialRequests || null,
    })
    if (!booking) {
      return NextResponse.json({ error: 'This room is no longer available for the selected dates. Please try again.' }, { status: 409 })
    }
    const confirmationCode = booking.confirmationCode

    // V05, second look: two requests sent at the same instant can both pass the check above. Count again
    // now that this booking exists and undo it if the guest went over the limit.
    if ((await countPendingRequests(email)) > MAX_PENDING_PER_GUEST) {
      await db.booking.delete({ where: { id: booking.id } })
      await audit({ action: 'booking.request.pending_cap', outcome: 'denied', actorId: sessionGuest.id, actorEmail: email, actorRole: 'GUEST', ip, userAgent, metadata: { stage: 'after_insert' } })
      return tooMany(`You already have ${MAX_PENDING_PER_GUEST} booking requests waiting for confirmation. Please wait for the hotel to reply, or contact us if you need more rooms.`)
    }
    await audit({ action: 'booking.request.created', outcome: 'success', actorId: sessionGuest.id, actorEmail: email, actorRole: 'GUEST', target: `booking:${confirmationCode}`, ip, userAgent })

    // ── Send emails ───────────────────────────────────────────────
    const checkInStr  = checkInDate.toISOString().slice(0, 10)
    const checkOutStr = checkOutDate.toISOString().slice(0, 10)

    const emailParams = {
      guestName,
      confirmCode:  confirmationCode,
      roomName:     roomType.displayName,
      boardPlan:    mealPlan,
      checkIn:      checkInStr,
      checkOut:     checkOutStr,
      nights,
      guests:       numGuests,
      totalUsd:     totalUsd.toFixed(2),
    }

    // Guest confirmation (fire-and-forget — don't block the response)
    // Resend resolves with { data, error } rather than throwing on API errors,
    // so both must be checked to avoid silently swallowing send failures.
    getResend().emails.send({
      from:    FROM_EMAIL,
      to:      email,
      subject: `Booking Request Received — ${confirmationCode} | Hotel Tamarind Tree`,
      html:    guestConfirmationEmailHtml(emailParams),
    }).then(({ error }) => {
      if (error) console.error('[email] guest confirmation failed:', error)
    }).catch(err => console.error('[email] guest confirmation failed:', err))

    // Staff notification
    getResend().emails.send({
      from:    FROM_EMAIL,
      to:      HOTEL_EMAIL,
      subject: `New Booking Request: ${confirmationCode} — ${guestName}`,
      html:    staffNotificationEmailHtml({
        ...emailParams,
        guestEmail:  email,
        guestPhone:  phone ?? '',
        specialReqs: specialRequests ?? '',
      }),
    }).then(({ error }) => {
      if (error) console.error('[email] staff notification failed:', error)
    }).catch(err => console.error('[email] staff notification failed:', err))

    // ── Return success ────────────────────────────────────────────
    return NextResponse.json({ confirmationCode })

  } catch (err) {
    console.error('[checkout] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
