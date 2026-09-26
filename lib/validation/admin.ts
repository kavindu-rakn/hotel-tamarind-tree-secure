// lib/validation/admin.ts
// Staff and admins are trusted people, but their forms still send data that a script (or a
// compromised staff account) can change. Every admin action checks its input the same way public
// requests do: right type, sane range, no unexpected fields. (V04, OWASP A04)
import { z } from 'zod'
import { isoDay, personName, phoneField, specialRequestsField, MAX_MAX_OCCUPANCY, MAX_STAY_NIGHTS } from './booking'

const DAY_MS = 86_400_000

/** database ids (cuid) - letters, digits, - and _ only */
export const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Invalid id.')

const price = z.number('Price must be a number.').min(1, 'Price must be at least 1 USD.').max(10_000, 'Price is unreasonably high.')
  .refine(v => Math.round(v * 100) / 100 === v, 'Price can have at most 2 decimal places.')

export const roomTypeUpdateSchema = z.strictObject({
  displayName: z.string().trim().min(1, 'Name is required.').max(80),
  description: z.string().max(4000),
  bedConfig: z.string().trim().min(1, 'Bed configuration is required.').max(60),
  maxOccupancy: z.number().int().min(1).max(MAX_MAX_OCCUPANCY, `At most ${MAX_MAX_OCCUPANCY} guests per room.`),
  sizeSqm: z.number().min(1).max(500).nullable(),
  isActive: z.boolean(),
})

export const ratePlanUpdateSchema = z.strictObject({
  priceUsd: price,
  isVisible: z.boolean(),
  isRefundable: z.boolean(),
  cancellationPolicy: z.string().max(2000),
})

export const blockedDateSchema = z.strictObject({
  roomUnitId: idSchema,
  startDate: isoDay,
  endDate: isoDay,
  reason: z.string().max(200),
}).refine(v => v.endDate > v.startDate, { message: 'End date must be after start date.', path: ['endDate'] })

export const cancelReasonSchema = z.string().max(500, 'Reason can be at most 500 characters.')

/** Staff may enter walk-ins and back-dated bookings, so unlike the public form there is no "not in the past" rule. */
export const manualBookingSchema = z.strictObject({
  roomSlug: z.string().regex(/^[a-z0-9-]{1,40}$/, 'Unknown room.'),
  mealPlan: z.enum(['BB', 'HB']),
  checkIn: isoDay,
  checkOut: isoDay,
  numGuests: z.number().int().min(1).max(MAX_MAX_OCCUPANCY),
  firstName: personName,
  lastName: personName,
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.')),
  phone: phoneField,
  specialRequests: specialRequestsField,
}).superRefine((v, ctx) => {
  const nights = Math.round((Date.parse(`${v.checkOut}T00:00:00Z`) - Date.parse(`${v.checkIn}T00:00:00Z`)) / DAY_MS)
  if (nights < 1 || nights > MAX_STAY_NIGHTS) ctx.addIssue({ code: 'custom', path: ['checkOut'], message: `Stay must be 1 to ${MAX_STAY_NIGHTS} nights.` })
})

/** Parse or throw one clear message (Next.js shows server-action errors to the caller, never the stack). */
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value)
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'Invalid input.')
  return r.data
}
