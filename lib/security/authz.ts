// Central permission check for admin server actions (V09, OWASP A01 Broken Access Control).
//
// The original `requireAdmin()` only asked "is anybody signed in?". It never looked at the ROLE, so a
// STAFF (front desk) account could change room prices and delete customer messages. Now every action
// states which roles may run it, and a refusal is written to the audit log.
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { audit } from '@/lib/security/audit'
import { getClientIp } from '@/lib/security/client-ip'

export type StaffRole = 'ADMIN' | 'STAFF'
export const STAFF_ROLES: StaffRole[] = ['ADMIN', 'STAFF'] // day-to-day work: bookings, inquiries
export const ADMIN_ONLY: StaffRole[] = ['ADMIN']           // prices, room catalogue, deleting data

export type StaffContext = {
  user: { id: string; email: string; name: string; role: StaffRole }
  /** Write a success entry to the audit log for what this staff member just did. */
  log: (action: string, target?: string, metadata?: Record<string, unknown>) => Promise<void>
}

export async function requireRole(allowed: StaffRole[], what: string): Promise<StaffContext> {
  const session = await auth()
  const user = session?.user
  const h = await headers()
  const ip = getClientIp(h)
  const userAgent = h.get('user-agent')

  if (!user || !allowed.includes(user.role as StaffRole)) {
    await audit({
      action: 'authz.denied', outcome: 'denied',
      actorId: user?.id, actorEmail: user?.email, actorRole: user?.role,
      target: what, ip, userAgent,
    })
    throw new Error('Forbidden')
  }

  return {
    user: user as StaffContext['user'],
    log: (action, target, metadata) =>
      audit({
        action, outcome: 'success',
        actorId: user.id, actorEmail: user.email, actorRole: user.role,
        target, ip, userAgent, metadata,
      }),
  }
}
