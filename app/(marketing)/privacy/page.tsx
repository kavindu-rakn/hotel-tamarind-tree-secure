import type { Metadata } from 'next'
import { SITE_NAME, SITE_EMAIL } from '@/lib/constants'

export const metadata: Metadata = {
  title: `Privacy Policy | ${SITE_NAME}`,
  description: 'What personal data Hotel Tamarind Tree collects when you sign in with Google, book a room or contact us, and why.',
}

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'Signing in with Google',
    body: [
      'To send a booking request you sign in with your Google account. Google tells us your name and your verified email address, and we receive nothing else: not your password, contacts, files or calendar.',
      'We use the email address so that booking confirmations reach you and so that you can see your own bookings under "My bookings". Your Google details are kept in a secure sign-in cookie in your browser, which expires after at most 24 hours or when you sign out.',
    ],
  },
  {
    title: 'What we store when you book or write to us',
    body: [
      'Booking requests: your name, verified email address, phone number (if you give one), dates, number of guests, room choice, special requests and the price. Contact form: your name, email, phone (optional), subject and message.',
      'We use this only to answer you, to manage your stay and to keep our records. We do not sell it and we do not use it for advertising.',
    ],
  },
  {
    title: 'Security records',
    body: [
      'To protect the site we keep a security log of events such as sign-ins, blocked attempts and changes made by staff. Entries can include your network (IP) address and browser type.',
    ],
  },
  {
    title: 'Who handles the data for us',
    body: [
      'Google (sign-in), Vercel (website hosting), Neon (database) and Resend (booking emails) process data on our behalf so that the site can work.',
    ],
  },
  {
    title: 'Your choices',
    body: [
      `You can ask us to correct or delete your booking or message records by writing to ${SITE_EMAIL}. You can remove this site's access from your Google account at any time at myaccount.google.com/permissions.`,
    ],
  },
]

export default function PrivacyPage() {
  return (
    <>
      <section className="relative pt-32 pb-16 overflow-hidden" style={{ background: 'linear-gradient(135deg, #3d1209 0%, #5e1e12 50%, #6D5840 100%)' }}>
        <div className="relative z-10 container-hotel text-center">
          <p className="text-label text-[#C9A96E] mb-3">Legal</p>
          <h1 className="text-display text-white mb-4">Privacy Policy</h1>
          <div className="w-16 h-0.5 bg-[#C9A96E] mx-auto" />
        </div>
      </section>
      <section className="py-16 bg-[#FAF7F2]">
        <div className="container-hotel max-w-3xl space-y-8">
          {SECTIONS.map(s => (
            <div key={s.title} className="bg-white rounded-xl border border-[#E5DDD3] p-8">
              <h2 className="font-serif text-xl font-semibold text-[#2C1A12] mb-3">{s.title}</h2>
              {s.body.map(p => <p key={p} className="text-[#5a3d2b] font-sans leading-relaxed mb-3 last:mb-0">{p}</p>)}
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
