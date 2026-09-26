import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { contactSchema } from '@/lib/validation/contact'
import { crossSiteBlock, readJsonBody } from '@/lib/security/request'
import { rateLimit } from '@/lib/security/rate-limit'
import { getClientIp } from '@/lib/security/client-ip'
import { audit } from '@/lib/security/audit'

// V06 (OWASP A04): the original accepted any size, from anyone, any number of times, and stored it.
// A 2000-character message is ~2 KB of JSON; 16 KB is a generous ceiling.
const MAX_BODY_BYTES = 16 * 1024
const PER_IP = { limit: 5, windowSec: 15 * 60 }
const PER_IP_WHEN_UNKNOWN = { limit: 30, windowSec: 15 * 60 } // address could not be determined: one shared, looser bucket
const PER_EMAIL = { limit: 5, windowSec: 60 * 60 }

function tooMany(retryAfterSec: number) {
  return NextResponse.json(
    { error: 'Too many messages. Please try again later or email us directly.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  )
}

export async function POST(request: NextRequest) {
  try {
    const blocked = crossSiteBlock(request)
    if (blocked) return blocked

    const ip = getClientIp(request.headers)
    const userAgent = request.headers.get('user-agent')

    // Count the attempt BEFORE doing any real work, so invalid requests use up the allowance too
    const ipRule = ip === 'unknown' ? PER_IP_WHEN_UNKNOWN : PER_IP
    const byIp = await rateLimit(`contact:ip:${ip}`, ipRule.limit, ipRule.windowSec)
    if (!byIp.allowed) {
      await audit({ action: 'contact.rate_limited', outcome: 'denied', ip, userAgent })
      return tooMany(byIp.retryAfterSec)
    }

    const read = await readJsonBody(request, MAX_BODY_BYTES)
    if (!read.ok) return read.response

    const parsed = contactSchema.safeParse(read.data)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return NextResponse.json({ error: first?.message ?? 'Please check the form.', field: first?.path?.[0] ?? null }, { status: 400 })
    }
    const { name, email, phone, subject, message, website } = parsed.data

    // Honeypot filled in -> a bot. Say "thanks" (so it learns nothing) but store nothing.
    if (website && website.trim() !== '') {
      await audit({ action: 'contact.honeypot', outcome: 'denied', actorEmail: email, ip, userAgent })
      return NextResponse.json({ success: true }, { status: 201 })
    }

    const byEmail = await rateLimit(`contact:email:${email}`, PER_EMAIL.limit, PER_EMAIL.windowSec)
    if (!byEmail.allowed) {
      await audit({ action: 'contact.rate_limited', outcome: 'denied', actorEmail: email, ip, userAgent, metadata: { by: 'email' } })
      return tooMany(byEmail.retryAfterSec)
    }

    await db.inquiry.create({
      data: { name, email, phone: phone || null, subject, message },
    })

    // TODO Phase 4: Send notification email to hotel

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    console.error('Contact form error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
