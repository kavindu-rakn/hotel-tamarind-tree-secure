'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireRole, STAFF_ROLES } from '@/lib/security/authz'
import { getResend, FROM_EMAIL } from '@/lib/resend'
import {
  generateConfirmationCode,
  assignAvailableUnit,
  countNights,
  bookingConfirmedEmailHtml,
  bookingCancelledEmailHtml,
} from '@/lib/booking-utils'
import { urlSlugToEnum } from '@/lib/utils'
import { parseInput, idSchema, cancelReasonSchema, manualBookingSchema } from '@/lib/validation/admin'

function isOverlapConflict(err: unknown): boolean {
  return err instanceof Error && err.message.includes('bookings_no_overlap_excl')
}

export async function confirmBooking(bookingId: string) {
  const ctx = await requireRole(STAFF_ROLES, 'booking.confirm')
  bookingId = parseInput(idSchema, bookingId)

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { guest: true, ratePlan: { include: { roomType: true } } },
  })
  if (!booking) throw new Error('Booking not found')
  if (booking.status !== 'PENDING') throw new Error('Only pending bookings can be confirmed')

  await db.booking.update({ where: { id: bookingId }, data: { status: 'CONFIRMED' } })
  await ctx.log('admin.booking.confirm', `booking:${bookingId}`, { code: booking.confirmationCode })

  const nights = countNights(booking.checkIn, booking.checkOut)
  getResend().emails.send({
    from:    FROM_EMAIL,
    to:      booking.guest.email,
    subject: `Booking Confirmed — ${booking.confirmationCode} | Hotel Tamarind Tree`,
    html: bookingConfirmedEmailHtml({
      guestName:   booking.guest.name,
      confirmCode: booking.confirmationCode,
      roomName:    booking.ratePlan.roomType.displayName,
      boardPlan:   booking.ratePlan.mealPlan,
      checkIn:     booking.checkIn.toISOString().slice(0, 10),
      checkOut:    booking.checkOut.toISOString().slice(0, 10),
      nights,
      guests:      booking.numGuests,
      totalUsd:    Number(booking.totalPriceUsd).toFixed(2),
    }),
  }).then(({ error }) => { if (error) console.error('[email] confirmation failed:', error) })
    .catch(err => console.error('[email] confirmation failed:', err))

  revalidatePath('/admin/bookings')
  revalidatePath('/admin')
}

export async function cancelBooking(bookingId: string, reason: string) {
  const ctx = await requireRole(STAFF_ROLES, 'booking.cancel')
  bookingId = parseInput(idSchema, bookingId)
  reason = parseInput(cancelReasonSchema, reason ?? '')

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { guest: true },
  })
  if (!booking) throw new Error('Booking not found')
  if (!['PENDING', 'CONFIRMED'].includes(booking.status)) {
    throw new Error('Only pending or confirmed bookings can be cancelled')
  }

  await db.booking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED', cancellationReason: reason || null },
  })
  await ctx.log('admin.booking.cancel', `booking:${bookingId}`, { code: booking.confirmationCode, reason: (reason ?? '').slice(0, 200) })

  getResend().emails.send({
    from:    FROM_EMAIL,
    to:      booking.guest.email,
    subject: `Booking Cancelled — ${booking.confirmationCode} | Hotel Tamarind Tree`,
    html:    bookingCancelledEmailHtml({ guestName: booking.guest.name, confirmCode: booking.confirmationCode, reason }),
  }).then(({ error }) => { if (error) console.error('[email] cancellation failed:', error) })
    .catch(err => console.error('[email] cancellation failed:', err))

  revalidatePath('/admin/bookings')
  revalidatePath('/admin')
}

export async function checkInBooking(bookingId: string) {
  const ctx = await requireRole(STAFF_ROLES, 'booking.check_in')
  bookingId = parseInput(idSchema, bookingId)
  const booking = await db.booking.findUnique({ where: { id: bookingId } })
  if (!booking) throw new Error('Booking not found')
  if (booking.status !== 'CONFIRMED') throw new Error('Only confirmed bookings can be checked in')

  await db.booking.update({ where: { id: bookingId }, data: { status: 'CHECKED_IN' } })
  await ctx.log('admin.booking.check_in', `booking:${bookingId}`)
  revalidatePath('/admin/bookings')
  revalidatePath('/admin')
}

export async function checkOutBooking(bookingId: string) {
  const ctx = await requireRole(STAFF_ROLES, 'booking.check_out')
  bookingId = parseInput(idSchema, bookingId)
  const booking = await db.booking.findUnique({ where: { id: bookingId } })
  if (!booking) throw new Error('Booking not found')
  if (booking.status !== 'CHECKED_IN') throw new Error('Only checked-in bookings can be checked out')

  await db.booking.update({ where: { id: bookingId }, data: { status: 'CHECKED_OUT' } })
  await ctx.log('admin.booking.check_out', `booking:${bookingId}`)
  revalidatePath('/admin/bookings')
  revalidatePath('/admin')
}

export async function markNoShow(bookingId: string) {
  const ctx = await requireRole(STAFF_ROLES, 'booking.no_show')
  bookingId = parseInput(idSchema, bookingId)
  const booking = await db.booking.findUnique({ where: { id: bookingId } })
  if (!booking) throw new Error('Booking not found')
  if (booking.status !== 'CONFIRMED') throw new Error('Only confirmed bookings can be marked as no-show')

  await db.booking.update({ where: { id: bookingId }, data: { status: 'NO_SHOW' } })
  await ctx.log('admin.booking.no_show', `booking:${bookingId}`)
  revalidatePath('/admin/bookings')
  revalidatePath('/admin')
}

export async function createManualBooking(rawInput: {
  roomSlug: string
  mealPlan: 'BB' | 'HB'
  checkIn: string
  checkOut: string
  numGuests: number
  firstName: string
  lastName: string
  email: string
  phone: string
  specialRequests: string
}) {
  const ctx = await requireRole(STAFF_ROLES, 'booking.create_manual')
  const input = parseInput(manualBookingSchema, rawInput)

  const enumSlug = urlSlugToEnum(input.roomSlug)
  if (!enumSlug) throw new Error('Invalid room type')

  const checkInDate  = new Date(`${input.checkIn}T00:00:00Z`)
  const checkOutDate = new Date(`${input.checkOut}T00:00:00Z`)
  const nights = countNights(checkInDate, checkOutDate)

  const roomType = await db.roomType.findUnique({ where: { slug: enumSlug } })
  if (!roomType) throw new Error('Room type not found')

  const ratePlan = await db.ratePlan.findFirst({
    where: { roomTypeId: roomType.id, mealPlan: input.mealPlan },
  })
  if (!ratePlan) throw new Error('Rate plan not found')

  const guestName = `${input.firstName.trim()} ${input.lastName.trim()}`
  let guest = await db.guest.findFirst({ where: { email: input.email.toLowerCase() } })
  if (!guest) {
    guest = await db.guest.create({
      data: { name: guestName, email: input.email.toLowerCase(), phone: input.phone || null },
    })
  }

  const totalUsd = Number(ratePlan.priceUsd) * nights

  for (let attempt = 0; attempt < 5; attempt++) {
    const unitId = await assignAvailableUnit(roomType.id, checkInDate, checkOutDate)
    if (!unitId) throw new Error('No rooms available for the selected dates')

    try {
      const created = await db.booking.create({
        data: {
          confirmationCode: generateConfirmationCode(),
          roomUnitId:       unitId,
          guestId:          guest.id,
          ratePlanId:       ratePlan.id,
          checkIn:          checkInDate,
          checkOut:         checkOutDate,
          numGuests:        input.numGuests,
          status:           'CONFIRMED',
          totalPriceUsd:    totalUsd,
          paymentStatus:    'UNPAID',
          specialRequests:  input.specialRequests || null,
        },
      })
      await ctx.log('admin.booking.create_manual', `booking:${created.id}`, { code: created.confirmationCode, room: input.roomSlug })
      revalidatePath('/admin/bookings')
      revalidatePath('/admin')
      return
    } catch (err) {
      if (isOverlapConflict(err)) continue
      if ((err as { code?: string })?.code === 'P2002') continue // reference collision: draw a new one
      throw err
    }
  }
  throw new Error('This room is no longer available for the selected dates. Please try again.')
}
