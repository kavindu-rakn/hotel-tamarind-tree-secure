import type { Metadata } from 'next'
import { SITE_NAME, SITE_EMAIL } from '@/lib/constants'

export const metadata: Metadata = {
  title: `Terms of Service | ${SITE_NAME}`,
  description: 'Terms for using the Hotel Tamarind Tree website and sending booking requests.',
}

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Booking requests',
    body: 'A booking request is not a confirmed reservation. Your room is reserved only when our team confirms it by email. Requests that we do not answer within 48 hours expire automatically and the room is released.',
  },
  {
    title: 'Payment',
    body: 'No payment is taken on this website. Our team will contact you to arrange payment when they confirm your reservation.',
  },
  {
    title: 'Your account and fair use',
    body: 'You need a Google account to send a booking request. Please give correct details and do not use the site to hold rooms you do not intend to take. We may limit or block requests that look automated or abusive.',
  },
  {
    title: 'Changes and questions',
    body: `Cancellation terms depend on the rate you choose and are confirmed in your booking email. Questions about these terms: ${SITE_EMAIL}.`,
  },
]

export default function TermsPage() {
  return (
    <>
      <section className="relative pt-32 pb-16 overflow-hidden" style={{ background: 'linear-gradient(135deg, #3d1209 0%, #5e1e12 50%, #6D5840 100%)' }}>
        <div className="relative z-10 container-hotel text-center">
          <p className="text-label text-[#C9A96E] mb-3">Legal</p>
          <h1 className="text-display text-white mb-4">Terms of Service</h1>
          <div className="w-16 h-0.5 bg-[#C9A96E] mx-auto" />
        </div>
      </section>
      <section className="py-16 bg-[#FAF7F2]">
        <div className="container-hotel max-w-3xl space-y-8">
          {SECTIONS.map(s => (
            <div key={s.title} className="bg-white rounded-xl border border-[#E5DDD3] p-8">
              <h2 className="font-serif text-xl font-semibold text-[#2C1A12] mb-3">{s.title}</h2>
              <p className="text-[#5a3d2b] font-sans leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
