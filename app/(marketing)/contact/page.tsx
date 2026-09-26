'use client'

import { useState } from 'react'
import { MapPin, Phone, Mail, Clock, Send, CheckCircle } from 'lucide-react'
import { SITE_EMAIL, SITE_PHONE, SITE_ADDRESS, SITE_NAME } from '@/lib/constants'

// Static metadata exported from a separate server component
// Contact page uses client component for the form state
export default function ContactPage() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', message: '', website: '' })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setStatus('sent')
      } else {
        // show the server's reason (e.g. "Please write a little more") when there is one
        const data = await res.json().catch(() => null)
        setErrorMessage(typeof data?.error === 'string' ? data.error : '')
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  return (
    <>
      {/* ── Hero ── */}
      <section
        className="relative pt-32 pb-20 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #3d1209 0%, #5e1e12 50%, #6D5840 100%)' }}
      >
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: `radial-gradient(circle at 1px 1px, #FAF7F2 1px, transparent 0)`, backgroundSize: '28px 28px' }} aria-hidden="true" />
        <div className="relative z-10 container-hotel text-center">
          <p className="text-label text-[#C9A96E] mb-3">Get In Touch</p>
          <h1 className="text-display text-[#C9A96E] mb-4">Contact Us</h1>
          <div className="w-16 h-0.5 bg-[#C9A96E] mx-auto mb-5" />
          <p className="max-w-md mx-auto text-white/75 font-sans leading-relaxed">
            We&apos;re here to help plan your perfect stay. Reach out with any questions, requests, or reservation enquiries.
          </p>
        </div>
      </section>

      {/* ── Contact grid ── */}
      <section className="py-20 bg-[#FAF7F2]">
        <div className="container-hotel grid grid-cols-1 lg:grid-cols-5 gap-12">

          {/* Left: Info */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white rounded-xl border border-[#E5DDD3] p-8">
              <h2 className="font-serif text-2xl font-semibold text-[#2C1A12] mb-6">Hotel Information</h2>
              <div className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 w-9 h-9 rounded-full bg-[#5e1e12]/10 flex items-center justify-center shrink-0">
                    <MapPin size={15} className="text-[#5e1e12]" />
                  </div>
                  <div>
                    <p className="font-sans font-semibold text-sm text-[#2C1A12] mb-0.5">Address</p>
                    <p className="text-sm text-[#5a3d2b]/80 font-sans leading-relaxed">{SITE_ADDRESS}</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 w-9 h-9 rounded-full bg-[#5e1e12]/10 flex items-center justify-center shrink-0">
                    <Phone size={15} className="text-[#5e1e12]" />
                  </div>
                  <div>
                    <p className="font-sans font-semibold text-sm text-[#2C1A12] mb-0.5">Phone</p>
                    <a href={`tel:${SITE_PHONE}`} className="text-sm text-[#5a3d2b]/80 font-sans hover:text-[#5e1e12] transition-colors">{SITE_PHONE}</a>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 w-9 h-9 rounded-full bg-[#5e1e12]/10 flex items-center justify-center shrink-0">
                    <Mail size={15} className="text-[#5e1e12]" />
                  </div>
                  <div>
                    <p className="font-sans font-semibold text-sm text-[#2C1A12] mb-0.5">Email</p>
                    <a href={`mailto:${SITE_EMAIL}`} className="text-sm text-[#5a3d2b]/80 font-sans hover:text-[#5e1e12] transition-colors">{SITE_EMAIL}</a>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 w-9 h-9 rounded-full bg-[#5e1e12]/10 flex items-center justify-center shrink-0">
                    <Clock size={15} className="text-[#5e1e12]" />
                  </div>
                  <div>
                    <p className="font-sans font-semibold text-sm text-[#2C1A12] mb-0.5">Front Desk Hours</p>
                    <p className="text-sm text-[#5a3d2b]/80 font-sans">24 hours, 7 days a week</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#2C1A12] rounded-xl p-8">
              <h3 className="font-serif text-lg font-semibold text-white mb-3">Check-in / Check-out</h3>
              <div className="space-y-2 text-sm font-sans text-white/70">
                <div className="flex justify-between">
                  <span>Check-in</span>
                  <span className="text-[#C9A96E] font-medium">From 2:00 PM</span>
                </div>
                <div className="flex justify-between">
                  <span>Check-out</span>
                  <span className="text-[#C9A96E] font-medium">By 11:00 AM</span>
                </div>
                <div className="flex justify-between">
                  <span>Early check-in</span>
                  <span className="text-white/50">On request</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Form */}
          <div className="lg:col-span-3 h-full">
            <div className="h-full flex flex-col bg-white rounded-xl border border-[#E5DDD3] p-8 shadow-[0_2px_20px_rgba(94,30,18,0.06)]">
              {status === 'sent' ? (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
                  <CheckCircle size={48} className="text-green-600" />
                  <h2 className="font-serif text-2xl font-semibold text-[#2C1A12]">Message Received!</h2>
                  <p className="text-[#5a3d2b]/80 font-sans max-w-sm leading-relaxed">
                    Thank you for reaching out. A member of our team will respond within 24 hours.
                  </p>
                </div>
              ) : (
                <>
                  <h2 className="font-serif text-2xl font-semibold text-[#2C1A12] mb-6">Send Us a Message</h2>
                  <form onSubmit={handleSubmit} className="flex-1 flex flex-col space-y-5" noValidate>
                    {/* Honeypot: hidden from people, visible to bots that fill every field. Do not remove. */}
                    <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
                      <label htmlFor="contact-website">Leave this field empty</label>
                      <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={handleChange} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div>
                        <label htmlFor="contact-name" className="block text-sm font-sans font-medium text-[#2C1A12] mb-1.5">Full Name *</label>
                        <input
                          id="contact-name"
                          name="name"
                          type="text"
                          required
                          value={form.name}
                          onChange={handleChange}
                          placeholder="Your name"
                          className="w-full px-4 py-3 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] placeholder-[#6D5840]/50 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors"
                        />
                      </div>
                      <div>
                        <label htmlFor="contact-email" className="block text-sm font-sans font-medium text-[#2C1A12] mb-1.5">Email Address *</label>
                        <input
                          id="contact-email"
                          name="email"
                          type="email"
                          required
                          value={form.email}
                          onChange={handleChange}
                          placeholder="you@example.com"
                          className="w-full px-4 py-3 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] placeholder-[#6D5840]/50 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div>
                        <label htmlFor="contact-phone" className="block text-sm font-sans font-medium text-[#2C1A12] mb-1.5">Phone Number</label>
                        <input
                          id="contact-phone"
                          name="phone"
                          type="tel"
                          value={form.phone}
                          onChange={handleChange}
                          placeholder="+1 234 567 890"
                          className="w-full px-4 py-3 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] placeholder-[#6D5840]/50 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors"
                        />
                      </div>
                      <div>
                        <label htmlFor="contact-subject" className="block text-sm font-sans font-medium text-[#2C1A12] mb-1.5">Subject *</label>
                        <select
                          id="contact-subject"
                          name="subject"
                          required
                          value={form.subject}
                          onChange={handleChange}
                          className="w-full px-4 py-3 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors"
                        >
                          <option value="">Select a subject</option>
                          <option value="reservation">Reservation Enquiry</option>
                          <option value="rates">Rates & Availability</option>
                          <option value="safari">Safari Arrangement</option>
                          <option value="group">Group Booking</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <label htmlFor="contact-message" className="block text-sm font-sans font-medium text-[#2C1A12] mb-1.5">Message *</label>
                      <textarea
                        id="contact-message"
                        name="message"
                        required
                        rows={5}
                        value={form.message}
                        onChange={handleChange}
                        placeholder="Tell us how we can help — include your preferred dates, number of guests, and any special requests."
                        className="w-full flex-1 min-h-[8rem] px-4 py-3 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] placeholder-[#6D5840]/50 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors resize-none"
                      />
                    </div>
                    {status === 'error' && (
                      <p className="text-sm text-red-600 font-sans" role="alert">{errorMessage || 'Something went wrong. Please try again or email us directly.'}</p>
                    )}
                    <button
                      id="contact-submit-btn"
                      type="submit"
                      disabled={status === 'sending'}
                      className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded bg-[#5e1e12] text-white font-sans font-semibold text-sm hover:bg-[#7a2a1c] hover:shadow-[0_4px_20px_rgba(94,30,18,0.35)] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {status === 'sending' ? 'Sending…' : (
                        <>Send Message <Send size={15} /></>
                      )}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
