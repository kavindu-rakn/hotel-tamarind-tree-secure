import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getGuest } from '@/lib/security/guest'
import { SITE_NAME } from '@/lib/constants'
import BookClient from './BookClient'

export const metadata: Metadata = {
  title: `Book | ${SITE_NAME}`,
}

interface Props {
  searchParams: Promise<{ room?: string }>
}

// Booking needs a Google sign-in. The check happens here on the server, so nobody reaches the form
// by editing the page in their browser - and /api/bookings/checkout repeats the check on its own.
export default async function BookPage({ searchParams }: Props) {
  const guest = await getGuest()
  if (!guest) {
    const { room } = await searchParams
    const back = room && /^[a-z0-9-]{1,40}$/.test(room) ? `/book?room=${room}` : '/book'
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(back)}`)
  }
  return <BookClient guestName={guest.name} guestEmail={guest.email} />
}
