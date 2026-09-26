// lib/validation/booking.ts
// What a booking request is allowed to look like. Everything the browser sends is untrusted: the
// original checked only that a few fields were "not empty", so negative guest counts, stays in 2020,
// ten-year stays and 300 KB names were all accepted and stored (V04, OWASP A04).
import { z } from 'zod'

export const MAX_STAY_NIGHTS = 30
export const MAX_ADVANCE_DAYS = 730
export const MAX_MAX_OCCUPANCY = 8 // hard ceiling; each room's own limit is checked against the database

const DAY_MS = 86_400_000

/** Today's date at the hotel (Sri Lanka), as YYYY-MM-DD. */
export function todayAtHotel(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const utcMidnight = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime()

/** A real calendar day written as YYYY-MM-DD (rejects 2026-02-31 and free-form text). */
export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be written like 2026-12-31.')
  .refine(v => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'That is not a real calendar date.')

/** Shared by the booking and availability endpoints. Returns an error message, or null when the stay is acceptable. */
export function checkStay(checkIn: string, checkOut: string, now = new Date()): string | null {
  const today = todayAtHotel(now)
  const nights = Math.round((utcMidnight(checkOut) - utcMidnight(checkIn)) / DAY_MS)
  if (checkIn < today) return 'Check-in cannot be in the past.'
  if (nights < 1) return 'Check-out must be after check-in.'
  if (nights > MAX_STAY_NIGHTS) return `We take bookings of up to ${MAX_STAY_NIGHTS} nights online. Please contact us for longer stays.`
  if ((utcMidnight(checkIn) - utcMidnight(today)) / DAY_MS > MAX_ADVANCE_DAYS) return 'That check-in date is too far ahead.'
  return null
}

// letters (any language), combining marks, space, apostrophe, hyphen, full stop - no digits, no < > & etc.
export const personName = z
  .string()
  .trim()
  .min(1, 'Please enter your name.')
  .max(60, 'That name is too long.')
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} '.\-]*$/u, 'Names can only contain letters, spaces, apostrophes, hyphens and full stops.')

// no control characters except line breaks and tabs
export const NO_CONTROL = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/

export const phoneField = z.string().trim().regex(/^\+?[0-9 ()\-]{7,20}$/, 'Phone numbers can contain digits, spaces, brackets, hyphens and a leading +.').or(z.literal('')).optional()
export const specialRequestsField = z.string().max(500, 'Special requests can be at most 500 characters.').regex(NO_CONTROL, 'Special requests contain characters we cannot accept.').optional()

export const bookingRequestSchema = z
  .strictObject({ // strictObject: any field we did not ask for is an error (stops "mass assignment")
    roomSlug: z.string().regex(/^[a-z0-9-]{1,40}$/, 'Unknown room.'),
    mealPlan: z.enum(['BB', 'HB'], 'Choose Bed & Breakfast or Half Board.'),
    checkIn: isoDay,
    checkOut: isoDay,
    numGuests: z.number('Number of guests must be a number.').int('Number of guests must be a whole number.').min(1, 'At least one guest is required.').max(MAX_MAX_OCCUPANCY, 'Too many guests for one room.'),
    firstName: personName,
    lastName: personName,
    phone: phoneField,
    specialRequests: specialRequestsField,
  })
  .superRefine((v, ctx) => {
    const problem = checkStay(v.checkIn, v.checkOut)
    if (problem) ctx.addIssue({ code: 'custom', path: ['checkIn'], message: problem })
  })

export type BookingRequest = z.infer<typeof bookingRequestSchema>
