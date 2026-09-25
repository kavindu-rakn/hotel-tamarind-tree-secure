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
    // V03 (part 1): only a guest who signed in with Google may book, and the confirmation goes to the
    // email address GOOGLE verified. The original took `email` from the request body, so anyone could
    // make the hotel's mail server send messages to any address they liked.
    const sessionGuest = await getGuest()
    if (!sessionGuest) {
      return NextResponse.json({ error: 'Please sign in with Google to make a booking request.' }, { status: 401 })
    }
    const email = sessionGuest.email

    const body = await req.json()
    const {
      roomSlug,
      mealPlan,
      checkIn,
      checkOut,
      numGuests,
      firstName,
      lastName,
      phone,
      specialRequests,
    } = body

    // ── Validate ─────────────────────────────────────────────────
    if (!roomSlug || !mealPlan || !checkIn || !checkOut || !firstName || !lastName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const enumSlug = urlSlugToEnum(roomSlug)
    if (!enumSlug) {
      return NextResponse.json({ error: 'Invalid room slug' }, { status: 400 })
    }

    const checkInDate  = new Date(checkIn)
    const checkOutDate = new Date(checkOut)
    const nights       = countNights(checkInDate, checkOutDate)

    if (nights < 1) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }

    // ── Fetch room type + rate plan ───────────────────────────────
    const roomType = await db.roomType.findUnique({ where: { slug: enumSlug } })
    if (!roomType) return NextResponse.json({ error: 'Room type not found' }, { status: 404 })

    const ratePlan = await db.ratePlan.findFirst({
      where: { roomTypeId: roomType.id, mealPlan: mealPlan as 'BB' | 'HB', isVisible: true },
    })
    if (!ratePlan) return NextResponse.json({ error: 'Rate plan not found' }, { status: 404 })

    // ── Create or find guest ──────────────────────────────────────
    const guestName = `${firstName.trim()} ${lastName.trim()}`
    let guest = await db.guest.findFirst({ where: { email } })
    if (!guest) {
      guest = await db.guest.create({
        data: { name: guestName, email, phone: phone ?? null },
      })
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
      numGuests:       numGuests ?? 1,
      totalUsd,
      specialRequests: specialRequests || null,
    })
    if (!booking) {
      return NextResponse.json({ error: 'This room is no longer available for the selected dates. Please try again.' }, { status: 409 })
    }
    const confirmationCode = booking.confirmationCode

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
      guests:       numGuests ?? 1,
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
