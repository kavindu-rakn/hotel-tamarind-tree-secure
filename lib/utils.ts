import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// ─── Tailwind class merger ────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Price formatting ─────────────────────────────────────────
export function formatUSD(amount: number | string | { toNumber(): number }): string {
  const num = typeof amount === 'object' ? amount.toNumber() : Number(amount)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)
}

// ─── Date formatting ──────────────────────────────────────────
export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatDateShort(date: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatDateInput(date: Date): string {
  // Returns YYYY-MM-DD for <input type="date">
  return date.toISOString().split('T')[0]
}

// ─── Night count ──────────────────────────────────────────────
export function getNightCount(checkIn: Date | string, checkOut: Date | string): number {
  const start = new Date(checkIn)
  const end   = new Date(checkOut)
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
}

// ─── Slugify ──────────────────────────────────────────────────
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ─── Meal plan display names ─────────────────────────────────
export function mealPlanLabel(plan: string): string {
  const labels: Record<string, string> = {
    BB: 'Bed & Breakfast',
    HB: 'Half Board',
    FB: 'Full Board',
  }
  return labels[plan] ?? plan
}

export function mealPlanDescription(plan: string): string {
  const descs: Record<string, string> = {
    BB: 'Room + Breakfast included',
    HB: 'Room + Breakfast + Lunch included',
    FB: 'Room + All meals included',
  }
  return descs[plan] ?? ''
}

// ─── Truncate ─────────────────────────────────────────────────
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

// ─── Room type slug mapping ───────────────────────────────────
// DB stores RoomTypeSlug enum (DELUXE_TWIN), URLs use kebab-case (deluxe-twin)

export const ROOM_SLUG_TO_ENUM = {
  'deluxe-twin':    'DELUXE_TWIN',
  'deluxe-double':  'DELUXE_DOUBLE',
  'deluxe-triple':  'DELUXE_TRIPLE',
  'family':         'FAMILY',
} as const

export const ROOM_ENUM_TO_SLUG = {
  'DELUXE_TWIN':    'deluxe-twin',
  'DELUXE_DOUBLE':  'deluxe-double',
  'DELUXE_TRIPLE':  'deluxe-triple',
  'FAMILY':         'family',
} as const

export type RoomUrlSlug = keyof typeof ROOM_SLUG_TO_ENUM
export type RoomEnumSlug = keyof typeof ROOM_ENUM_TO_SLUG

/** Convert URL slug (deluxe-twin) → DB enum (DELUXE_TWIN) */
export function urlSlugToEnum(slug: string): RoomEnumSlug | null {
  return (ROOM_SLUG_TO_ENUM as Record<string, RoomEnumSlug>)[slug] ?? null
}

/** Convert DB enum (DELUXE_TWIN) → URL slug (deluxe-twin) */
export function enumToUrlSlug(enumSlug: string): RoomUrlSlug | null {
  return (ROOM_ENUM_TO_SLUG as Record<string, RoomUrlSlug>)[enumSlug] ?? null
}

/** Room image paths (stored in /public/rooms/) */
export function getRoomImagePath(urlSlug: string): string {
  if (urlSlug === 'family') return `/rooms/family-updated.png`
  return `/rooms/${urlSlug}.png`
}
