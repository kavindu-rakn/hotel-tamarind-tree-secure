// Audit trail (V12, OWASP A09). Answers "who did what, when, from where?" after an incident.
// Rules: never put passwords, tokens or cookies in here; cut every value to a sane length so an
// attacker cannot bloat the table or smuggle newlines into log lines.
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export type AuditEvent = {
  action: string
  outcome: 'success' | 'failure' | 'denied'
  actorId?: string | null
  actorEmail?: string | null
  actorRole?: string | null
  target?: string | null
  ip?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
}

const cut = (v: string | null | undefined, n: number) => (v ? v.replace(/[\r\n\t]+/g, ' ').slice(0, n) : null)

export async function audit(e: AuditEvent): Promise<void> {
  const data = {
    action: e.action.slice(0, 80),
    outcome: e.outcome,
    actorId: cut(e.actorId, 64),
    actorEmail: cut(e.actorEmail, 254),
    actorRole: cut(e.actorRole, 20),
    target: cut(e.target, 120),
    ip: cut(e.ip, 45),
    userAgent: cut(e.userAgent, 200),
    metadata: (e.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
  }
  // 1) structured line for the hosting provider's log viewer (Vercel keeps these searchable)
  console.log('[audit]', JSON.stringify({ ts: new Date().toISOString(), ...data }))
  // 2) durable copy in our own database. An audit failure must never break the user's request.
  try {
    await prisma.auditLog.create({ data })
  } catch (err) {
    console.error('[audit] could not write audit log row:', err instanceof Error ? err.message : err)
  }
}
