// lib/booking-utils.ts
import { db } from '@/lib/db'
import { escapeHtml } from '@/lib/security/html'

// ─── Confirmation Code ─────────────────────────────────────────────────────
// Format: HTT-YYYYMMDD-XXXX-XXXX-XXXX  (e.g. HTT-20260705-A3B2-K7QM-R9HZ)
//
// V11: the original was HTT-YYYYMMDD-XXXX with the 4 letters drawn by Math.random(). Math.random is not
// a secure generator (its output can be predicted) and 4 characters are only about a million
// possibilities, so a script could guess other guests' references. Now: 12 characters from a secure
// random source (crypto.randomInt, no modulo bias) = 32^12 = 2^60, about 10^18 possibilities.
import { randomInt } from 'node:crypto'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0,O,1,I to avoid confusion (32 symbols)

function randomAlphanumeric(length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) result += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return result
}

export function generateConfirmationCode(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `HTT-${date}-${randomAlphanumeric(4)}-${randomAlphanumeric(4)}-${randomAlphanumeric(4)}`
}

// ─── Night count ───────────────────────────────────────────────────────────

export function countNights(checkIn: Date, checkOut: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24
  return Math.round((checkOut.getTime() - checkIn.getTime()) / msPerDay)
}

// ─── Availability Query ────────────────────────────────────────────────────
// Returns room types that have at least one free unit for the given date range.
// "Active" bookings = PENDING or CONFIRMED (CANCELLED / NO_SHOW don't block).

export async function findAvailableRoomTypes(
  checkIn: Date,
  checkOut: Date,
  guests: number,
) {
  // Find all room units that are occupied (overlapping booking exists)
  const [occupiedUnitIds, blockedUnitIds] = await Promise.all([
    db.booking.findMany({
      where: {
        status: { in: ['PENDING', 'CONFIRMED'] },
        checkIn:  { lt: checkOut },
        checkOut: { gt: checkIn  },
      },
      select: { roomUnitId: true },
    }),
    db.blockedDate.findMany({
      where: { startDate: { lt: checkOut }, endDate: { gt: checkIn } },
      select: { roomUnitId: true },
    }),
  ])
  const occupiedIds = [...occupiedUnitIds.map(b => b.roomUnitId), ...blockedUnitIds.map(b => b.roomUnitId)]

  // Find room types that have at least one unit that is NOT occupied
  const roomTypes = await db.roomType.findMany({
    where: {
      isActive: true,
      maxOccupancy: { gte: guests },
      units: {
        some: {
          isActive: true,
          id: { notIn: occupiedIds },
        },
      },
    },
    include: {
      ratePlans: {
        where: { isVisible: true },
        orderBy: { priceUsd: 'asc' },
      },
      units: {
        where: {
          isActive: true,
          id: { notIn: occupiedIds },
        },
        select: { id: true, unitNumber: true },
        take: 1, // we just need to know one is free
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return roomTypes
}

// ─── Assign first available unit ───────────────────────────────────────────
// Called when creating a booking — picks the lowest unit number available.

export async function assignAvailableUnit(
  roomTypeId: string,
  checkIn: Date,
  checkOut: Date,
): Promise<string | null> {
  const [occupied, blocked] = await Promise.all([
    db.booking.findMany({
      where: {
        status: { in: ['PENDING', 'CONFIRMED'] },
        checkIn:  { lt: checkOut },
        checkOut: { gt: checkIn  },
        roomUnit: { roomTypeId },
      },
      select: { roomUnitId: true },
    }),
    db.blockedDate.findMany({
      where: {
        startDate: { lt: checkOut },
        endDate: { gt: checkIn },
        roomUnit: { roomTypeId },
      },
      select: { roomUnitId: true },
    }),
  ])
  const occupiedIds = [...occupied.map(b => b.roomUnitId), ...blocked.map(b => b.roomUnitId)]

  const available = await db.roomUnit.findMany({
    where: {
      roomTypeId,
      isActive: true,
      id: { notIn: occupiedIds },
    },
    select: { id: true },
  })
  if (available.length === 0) return null

  // Pick randomly rather than always the lowest unit number — under
  // concurrent requests, always picking the same "first" unit means every
  // request piles onto one row and only one winner emerges per retry round,
  // starving out requests even when other units are free. Randomizing
  // spreads concurrent requests across different units so more succeed.
  // (Math.random is fine here: this only spreads load, nothing depends on it being unpredictable)
  return available[Math.floor(Math.random() * available.length)].id
}

// ─── Email templates ───────────────────────────────────────────────────────

export function guestConfirmationEmailHtml(params: {
  guestName:    string
  confirmCode:  string
  roomName:     string
  boardPlan:    string
  checkIn:      string
  checkOut:     string
  nights:       number
  guests:       number
  totalUsd:     string
}): string {
  const { guestName, confirmCode, roomName, boardPlan, checkIn, checkOut, nights, guests, totalUsd } = params
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Booking Confirmed – Hotel Tamarind Tree</title>
</head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(94,30,18,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#3d1209,#5e1e12);padding:36px 40px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;letter-spacing:3px;color:#C9A96E;text-transform:uppercase;">HOTEL</p>
            <h1 style="margin:0;font-size:28px;color:#ffffff;font-weight:400;letter-spacing:1px;">Tamarind Tree</h1>
            <p style="margin:12px 0 0;font-size:13px;color:#FAF7F2;opacity:0.7;">Tissamaharama, Sri Lanka</p>
          </td>
        </tr>
        <!-- Status -->
        <tr>
          <td style="padding:32px 40px 0;text-align:center;">
            <div style="display:inline-block;background:#fff8e1;border:1px solid #ffe082;border-radius:24px;padding:6px 20px;">
              <span style="color:#f57f17;font-size:13px;font-family:Arial,sans-serif;font-weight:600;">⏳ Booking Request Received</span>
            </div>
            <h2 style="margin:20px 0 4px;font-size:22px;color:#2C1A12;">Thank you, ${escapeHtml(guestName)}!</h2>
            <p style="margin:0;font-size:14px;color:#6D5840;font-family:Arial,sans-serif;">We have received your booking request and will get in touch within 24 hours to confirm your reservation.</p>
          </td>
        </tr>
        <!-- Confirmation code -->
        <tr>
          <td style="padding:24px 40px;">
            <div style="background:#FAF7F2;border:1px solid #E5DDD3;border-radius:8px;padding:20px;text-align:center;">
              <p style="margin:0 0 6px;font-size:11px;color:#6D5840;font-family:Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;">Booking Reference</p>
              <p style="margin:0;font-size:20px;font-weight:700;color:#5e1e12;font-family:monospace;letter-spacing:2px;word-break:break-all;">${escapeHtml(confirmCode)}</p>
            </div>
          </td>
        </tr>
        <!-- Details -->
        <tr>
          <td style="padding:0 40px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5DDD3;border-radius:8px;overflow:hidden;">
              <tr style="background:#5e1e12;">
                <td style="padding:12px 20px;font-size:12px;color:#FAF7F2;font-family:Arial,sans-serif;font-weight:600;letter-spacing:1px;text-transform:uppercase;" colspan="2">Reservation Details</td>
              </tr>
              ${[
                ['Room',       roomName],
                ['Board Plan', boardPlan === 'BB' ? 'Bed & Breakfast' : 'Half Board (Bed, Breakfast & Lunch)'],
                ['Check-in',   checkIn + ' (from 2:00 PM)'],
                ['Check-out',  checkOut + ' (by 11:00 AM)'],
                ['Duration',   `${nights} night${nights !== 1 ? 's' : ''}`],
                ['Guests',     `${guests} guest${guests !== 1 ? 's' : ''}`],
                ['Total Paid', `USD ${totalUsd}`],
              ].map(([label, value], i) => `
              <tr style="background:${i % 2 === 0 ? '#ffffff' : '#FAF7F2'};">
                <td style="padding:12px 20px;font-size:13px;color:#6D5840;font-family:Arial,sans-serif;width:40%;">${escapeHtml(label)}</td>
                <td style="padding:12px 20px;font-size:13px;color:#2C1A12;font-family:Arial,sans-serif;font-weight:600;">${escapeHtml(value)}</td>
              </tr>`).join('')}
            </table>
          </td>
        </tr>
        <!-- What's next -->
        <tr>
          <td style="padding:0 40px 32px;">
            <h3 style="margin:0 0 12px;font-size:16px;color:#2C1A12;">What happens next?</h3>
            <ul style="margin:0;padding:0 0 0 20px;font-size:13px;color:#5a3d2b;font-family:Arial,sans-serif;line-height:2;">
              <li>You will receive this email as your booking confirmation. Please save it.</li>
              <li>Present your booking reference <strong>${escapeHtml(confirmCode)}</strong> upon check-in.</li>
              <li>Check-in is from <strong>2:00 PM</strong>. Late check-in? Please let us know in advance.</li>
              <li>Have questions? Reply to this email or call us directly.</li>
            </ul>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#2C1A12;padding:24px 40px;text-align:center;">
            <p style="margin:0 0 4px;font-size:12px;color:#FAF7F2;font-family:Arial,sans-serif;">Hotel Tamarind Tree &bull; Tissamaharama, Sri Lanka</p>
            <p style="margin:0;font-size:12px;color:#C9A96E;font-family:Arial,sans-serif;">info@tamarindtree.lk</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim()
}

export function staffNotificationEmailHtml(params: {
  guestName:   string
  guestEmail:  string
  guestPhone:  string
  confirmCode: string
  roomName:    string
  boardPlan:   string
  checkIn:     string
  checkOut:    string
  nights:      number
  guests:      number
  totalUsd:    string
  specialReqs: string
}): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #ddd;">
    <div style="background:#5e1e12;padding:20px 28px;">
      <h2 style="margin:0;color:#fff;font-size:18px;">New Direct Booking — ${escapeHtml(params.confirmCode)}</h2>
    </div>
    <div style="padding:24px 28px;">
      <table width="100%" cellpadding="6" cellspacing="0" style="font-size:13px;color:#333;">
        <tr><td><strong>Guest</strong></td><td>${escapeHtml(params.guestName)}</td></tr>
        <tr><td><strong>Email</strong></td><td>${escapeHtml(params.guestEmail)}</td></tr>
        <tr><td><strong>Phone</strong></td><td>${escapeHtml(params.guestPhone) || '—'}</td></tr>
        <tr><td><strong>Room</strong></td><td>${escapeHtml(params.roomName)}</td></tr>
        <tr><td><strong>Board</strong></td><td>${escapeHtml(params.boardPlan)}</td></tr>
        <tr><td><strong>Check-in</strong></td><td>${escapeHtml(params.checkIn)}</td></tr>
        <tr><td><strong>Check-out</strong></td><td>${escapeHtml(params.checkOut)}</td></tr>
        <tr><td><strong>Nights</strong></td><td>${escapeHtml(params.nights)}</td></tr>
        <tr><td><strong>Guests</strong></td><td>${escapeHtml(params.guests)}</td></tr>
        <tr><td><strong>Total</strong></td><td>USD ${escapeHtml(params.totalUsd)}</td></tr>
        <tr><td><strong>Special Requests</strong></td><td>${escapeHtml(params.specialReqs) || 'None'}</td></tr>
      </table>
    </div>
  </div>
</body>
</html>
  `.trim()
}

// ─── Booking confirmed / cancelled (staff actions) ─────────────────────────

export function bookingConfirmedEmailHtml(params: {
  guestName:   string
  confirmCode: string
  roomName:    string
  boardPlan:   string
  checkIn:     string
  checkOut:    string
  nights:      number
  guests:      number
  totalUsd:    string
}): string {
  const { guestName, confirmCode, roomName, boardPlan, checkIn, checkOut, nights, guests, totalUsd } = params
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><title>Booking Confirmed – Hotel Tamarind Tree</title></head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(94,30,18,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#3d1209,#5e1e12);padding:36px 40px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;letter-spacing:3px;color:#C9A96E;text-transform:uppercase;">HOTEL</p>
            <h1 style="margin:0;font-size:28px;color:#ffffff;font-weight:400;letter-spacing:1px;">Tamarind Tree</h1>
            <p style="margin:12px 0 0;font-size:13px;color:#FAF7F2;opacity:0.7;">Tissamaharama, Sri Lanka</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 0;text-align:center;">
            <div style="display:inline-block;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:24px;padding:6px 20px;">
              <span style="color:#2e7d32;font-size:13px;font-family:Arial,sans-serif;font-weight:600;">✓ Booking Confirmed</span>
            </div>
            <h2 style="margin:20px 0 4px;font-size:22px;color:#2C1A12;">You&apos;re all set, ${escapeHtml(guestName)}!</h2>
            <p style="margin:0;font-size:14px;color:#6D5840;font-family:Arial,sans-serif;">Our team has confirmed your reservation. We look forward to welcoming you.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;">
            <div style="background:#FAF7F2;border:1px solid #E5DDD3;border-radius:8px;padding:20px;text-align:center;">
              <p style="margin:0 0 6px;font-size:11px;color:#6D5840;font-family:Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;">Booking Reference</p>
              <p style="margin:0;font-size:20px;font-weight:700;color:#5e1e12;font-family:monospace;letter-spacing:2px;word-break:break-all;">${escapeHtml(confirmCode)}</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5DDD3;border-radius:8px;overflow:hidden;">
              <tr style="background:#5e1e12;">
                <td style="padding:12px 20px;font-size:12px;color:#FAF7F2;font-family:Arial,sans-serif;font-weight:600;letter-spacing:1px;text-transform:uppercase;" colspan="2">Reservation Details</td>
              </tr>
              ${[
                ['Room',       roomName],
                ['Board Plan', boardPlan === 'BB' ? 'Bed & Breakfast' : 'Half Board (Bed, Breakfast & Lunch)'],
                ['Check-in',   checkIn + ' (from 2:00 PM)'],
                ['Check-out',  checkOut + ' (by 11:00 AM)'],
                ['Duration',   `${nights} night${nights !== 1 ? 's' : ''}`],
                ['Guests',     `${guests} guest${guests !== 1 ? 's' : ''}`],
                ['Total',      `USD ${totalUsd}`],
              ].map(([label, value], i) => `
              <tr style="background:${i % 2 === 0 ? '#ffffff' : '#FAF7F2'};">
                <td style="padding:12px 20px;font-size:13px;color:#6D5840;font-family:Arial,sans-serif;width:40%;">${escapeHtml(label)}</td>
                <td style="padding:12px 20px;font-size:13px;color:#2C1A12;font-family:Arial,sans-serif;font-weight:600;">${escapeHtml(value)}</td>
              </tr>`).join('')}
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#2C1A12;padding:24px 40px;text-align:center;">
            <p style="margin:0 0 4px;font-size:12px;color:#FAF7F2;font-family:Arial,sans-serif;">Hotel Tamarind Tree &bull; Tissamaharama, Sri Lanka</p>
            <p style="margin:0;font-size:12px;color:#C9A96E;font-family:Arial,sans-serif;">info@tamarindtree.lk</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim()
}

export function bookingCancelledEmailHtml(params: {
  guestName:   string
  confirmCode: string
  reason:      string
}): string {
  const { guestName, confirmCode, reason } = params
  return `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#FAF7F2;padding:40px 16px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5DDD3;">
    <div style="background:#5e1e12;padding:28px 32px;">
      <h2 style="margin:0;color:#fff;font-size:18px;font-weight:400;">Hotel Tamarind Tree</h2>
    </div>
    <div style="padding:28px 32px;">
      <h3 style="margin:0 0 12px;font-size:18px;color:#2C1A12;">Booking Cancelled</h3>
      <p style="margin:0 0 16px;font-size:14px;color:#5a3d2b;line-height:1.6;">
        Hi ${escapeHtml(guestName)}, your booking <strong>${escapeHtml(confirmCode)}</strong> has been cancelled.
      </p>
      ${reason ? `<p style="margin:0 0 16px;font-size:13px;color:#6D5840;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ''}
      <p style="margin:0;font-size:13px;color:#6D5840;">If you believe this is a mistake, please contact us at info@tamarindtree.lk.</p>
    </div>
  </div>
</body>
</html>
  `.trim()
}
