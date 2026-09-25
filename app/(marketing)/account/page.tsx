import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getGuest } from '@/lib/security/guest'
import { SITE_NAME } from '@/lib/constants'

export const metadata: Metadata = {
  title: `My bookings | ${SITE_NAME}`,
  robots: { index: false },
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Waiting for hotel confirmation',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Completed',
  NO_SHOW: 'No show',
}

const day = (d: Date) => d.toISOString().slice(0, 10)

// A signed-in guest sees ONLY the bookings made under their own verified email address.
// The email comes from the signed session, never from the URL or a form, so there is no id in the
// address bar that could be changed to look at somebody else's booking.
export default async function AccountPage() {
  const guest = await getGuest()
  if (!guest) redirect('/sign-in?callbackUrl=/account')

  const bookings = await db.booking.findMany({
    where: { guest: { email: { equals: guest.email, mode: 'insensitive' } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      confirmationCode: true, status: true, checkIn: true, checkOut: true, numGuests: true, totalPriceUsd: true,
      roomUnit: { select: { roomType: { select: { displayName: true } } } },
    },
  })

  return (
    <>
      <section
        className="relative pt-32 pb-16 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #3d1209 0%, #5e1e12 50%, #6D5840 100%)' }}
      >
        <div className="relative z-10 container-hotel text-center">
          <p className="text-label text-[#C9A96E] mb-3">{guest.email}</p>
          <h1 className="text-display text-white mb-4">My bookings</h1>
          <div className="w-16 h-0.5 bg-[#C9A96E] mx-auto" />
        </div>
      </section>

      <section className="py-16 bg-[#FAF7F2]">
        <div className="container-hotel max-w-3xl">
          {bookings.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#E5DDD3] p-8 text-center">
              <p className="text-[#5a3d2b] font-sans mb-4">You have not made a booking request yet.</p>
              <Link href="/book" className="inline-flex px-6 py-3 bg-[#5e1e12] text-white font-sans font-semibold text-sm rounded hover:bg-[#7a2a1c] transition-colors">
                Book a room
              </Link>
            </div>
          ) : (
            <ul className="space-y-4">
              {bookings.map(b => (
                <li key={b.confirmationCode} className="bg-white rounded-xl border border-[#E5DDD3] shadow-[0_2px_20px_rgba(94,30,18,0.06)] p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                    <p className="font-mono text-lg font-bold text-[#5e1e12] tracking-wider">{b.confirmationCode}</p>
                    <span className="text-xs font-sans font-semibold uppercase tracking-wider text-[#6D5840]">{STATUS_LABEL[b.status] ?? b.status}</span>
                  </div>
                  <p className="font-serif text-xl text-[#2C1A12] mb-1">{b.roomUnit.roomType.displayName}</p>
                  <p className="text-sm text-[#5a3d2b] font-sans">
                    {day(b.checkIn)} → {day(b.checkOut)} · {b.numGuests} guest{b.numGuests === 1 ? '' : 's'} · USD ${Number(b.totalPriceUsd).toFixed(2)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
