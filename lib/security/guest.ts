// lib/security/guest.ts
// "Who is the guest making this request?" - the ONE place that answers it.
// A guest is someone who signed in with Google. Staff accounts are deliberately NOT guests:
// a staff session cannot be used to place bookings and a guest session cannot open /admin.
import { auth } from '@/lib/auth'

export type GuestIdentity = {
  /** Google's stable id for this person, e.g. "google:1084...". Never changes even if they change email. */
  id: string
  /** Email address that Google has verified. Booking emails go here and nowhere else. */
  email: string
  name: string
}

export async function getGuest(): Promise<GuestIdentity | null> {
  const session = await auth()
  const u = session?.user
  if (!u || u.role !== 'GUEST' || !u.email) return null
  return { id: u.id, email: u.email.toLowerCase(), name: u.name ?? '' }
}

/**
 * Only allow redirects to a page on this site. Stops "open redirect" tricks such as
 * /sign-in?callbackUrl=https://evil.example or //evil.example.
 */
export function safeReturnPath(raw: string | null | undefined, fallback = '/book'): string {
  if (!raw || typeof raw !== 'string') return fallback
  if (raw.length > 300) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  if (/[\u0000-\u001f]/.test(raw)) return fallback
  return raw
}
