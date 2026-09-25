'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Image from 'next/image'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  CalendarDays, Users, ChevronRight, ChevronLeft, Loader2,
  BedDouble, Check, AlertCircle, ArrowRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────

interface RateOption {
  id:           string
  pricePerNight: number
  totalUsd:     number
}

interface AvailableRoom {
  id:           string
  slug:         string
  displayName:  string
  maxOccupancy: number
  bedConfig:    string
  imagePath:    string
  nights:       number
  rates: {
    BB: RateOption | null
    HB: RateOption | null
  }
}

type MealPlan = 'BB' | 'HB'
type Step = 1 | 2 | 3

// ─── Helpers ─────────────────────────────────────────────────────────────

function today()    { return new Date().toISOString().slice(0, 10) }
function tomorrow() {
  const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10)
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Step Indicator ──────────────────────────────────────────────────────

function StepIndicator({ step, setStep, roomsCount, hasSelectedRoom }: { step: Step, setStep: (s: Step) => void, roomsCount: number, hasSelectedRoom: boolean }) {
  const steps = ['Dates & Guests', 'Select Room', 'Your Details']
  
  const canGoToStep = (s: Step) => {
    if (s === 1) return true;
    if (s === 2) return roomsCount > 0;
    if (s === 3) return hasSelectedRoom;
    return false;
  }

  return (
    <div className="relative flex items-center justify-between mb-16 mx-4 sm:mx-12">
      {/* Background connecting line */}
      <div className="absolute left-0 right-0 top-4 h-[2px] bg-[#E5DDD3] z-0 translate-y-[-50%]" />
      
      {/* Active connecting line */}
      <div 
        className="absolute left-0 top-4 h-[2px] bg-[#5e1e12] z-0 translate-y-[-50%] transition-all duration-500 ease-in-out"
        style={{ width: `${((step - 1) / (steps.length - 1)) * 100}%` }}
      />

      {steps.map((label, i) => {
        const s = (i + 1) as Step
        const active    = s === step
        const completed = s < step
        const isClickable = canGoToStep(s)
        
        return (
          <div 
            key={s} 
            className="relative z-10 flex flex-col items-center group outline-none"
            onClick={() => { if (isClickable) setStep(s) }}
            role={isClickable ? 'button' : 'default'}
            tabIndex={isClickable ? 0 : -1}
            onKeyDown={(e) => { if (isClickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setStep(s); } }}
            style={{ cursor: isClickable ? 'pointer' : 'default' }}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold font-sans transition-all duration-300 ${
              completed 
                ? 'bg-[#5e1e12] text-white border-2 border-[#5e1e12] shadow-md' 
                : active 
                  ? 'bg-[#5e1e12] text-white ring-4 ring-[#5e1e12]/20 border-2 border-[#5e1e12] shadow-md' 
                  : 'bg-[#FAF7F2] border-2 border-[#E5DDD3] text-[#6D5840]'
            } ${isClickable && !active ? 'group-hover:border-[#5e1e12]/50' : ''}`}>
              {completed ? <Check size={14} /> : s}
            </div>
            <span className={`absolute top-10 text-xs font-sans whitespace-nowrap transition-colors duration-300 ${active ? 'text-[#5e1e12] font-bold' : 'text-[#6D5840] font-medium'}`}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────

// The signed-in guest is passed in by page.tsx (a server component that has already checked the Google
// session). Their email is shown but cannot be edited: it is the address Google verified, and the
// server uses the session, not anything typed in this form.
interface BookClientProps {
  guestName:  string
  guestEmail: string
}

export default function BookClient(props: BookClientProps) {
  return (
    <Suspense fallback={null}>
      <BookPageInner {...props} />
    </Suspense>
  )
}

function BookPageInner({ guestName, guestEmail }: BookClientProps) {
  const searchParams = useSearchParams()
  const router       = useRouter()

  // Step state with browser history integration
  const [step, _setStep] = useState<Step>(1)
  
  const setStep = useCallback((newStep: Step) => {
    _setStep(newStep)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('step', newStep.toString())
      window.history.pushState({ step: newStep }, '', url.toString())
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Set initial state for popstate
    const params = new URLSearchParams(window.location.search)
    const urlStep = params.get('step')
    const initialStep = urlStep ? (Number(urlStep) as Step) : 1
    if (initialStep !== 1) _setStep(initialStep)
    
    window.history.replaceState({ step: initialStep }, '', window.location.href)

    const handlePopState = (e: PopStateEvent) => {
      if (e.state && e.state.step) {
        _setStep(e.state.step as Step)
      } else {
        const currentUrlStep = new URLSearchParams(window.location.search).get('step')
        if (currentUrlStep) _setStep(Number(currentUrlStep) as Step)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Step 1 — search
  const [checkIn,  setCheckIn]  = useState(today())
  const [checkOut, setCheckOut] = useState(tomorrow())
  const [guests,   setGuests]   = useState(2)

  // Step 2 — room selection
  const [rooms,         setRooms]         = useState<AvailableRoom[]>([])
  const [loading,       setLoading]       = useState(false)
  const [searchError,   setSearchError]   = useState('')
  const [selectedRoom,  setSelectedRoom]  = useState<AvailableRoom | null>(null)
  const [selectedPlan,  setSelectedPlan]  = useState<MealPlan>('BB')

  // Step 3 — guest details
  const [firstName,    setFirstName]    = useState(() => guestName.split(' ')[0] ?? '')
  const [lastName,     setLastName]     = useState(() => guestName.split(' ').slice(1).join(' '))
  const [phone,        setPhone]        = useState('')
  const [specialReqs,  setSpecialReqs]  = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [submitError,  setSubmitError]  = useState('')

  // Pre-fill room slug from URL (e.g. /book?room=deluxe-twin)
  const prefilledRoom = searchParams.get('room')

  // Auto-search if arriving from a room card with dates set
  const searchAvailability = useCallback(async () => {
    setLoading(true)
    setSearchError('')
    setRooms([])
    try {
      const res = await fetch(`/api/availability?checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`)

      let data
      try {
        data = await res.json()
      } catch {
        setSearchError('The server took too long to respond. Please try again in a moment.')
        return
      }

      if (!res.ok) { setSearchError(data.error ?? 'Search failed'); return }
      setRooms(data.results)
      if (data.results.length === 0) {
        setSearchError('No rooms available for these dates. Try different dates or contact us directly.')
        return
      }
      setStep(2)
      // Auto-select if coming from a room card
      if (prefilledRoom) {
        const match = data.results.find((r: AvailableRoom) => r.slug === prefilledRoom)
        if (match) setSelectedRoom(match)
      }
    } catch {
      setSearchError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [checkIn, checkOut, guests, prefilledRoom])

  // Ensure checkout is always after checkin
  useEffect(() => {
    if (checkOut <= checkIn) {
      const d = new Date(checkIn); d.setDate(d.getDate() + 1)
      setCheckOut(d.toISOString().slice(0, 10))
    }
  }, [checkIn, checkOut])

  const nights = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)

  const selectedRate = selectedRoom?.rates[selectedPlan] ?? null

  async function handleSubmit() {
    if (!selectedRoom || !selectedRate) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch('/api/bookings/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomSlug:        selectedRoom.slug,
          mealPlan:        selectedPlan,
          checkIn,
          checkOut,
          numGuests:       guests,
          firstName,
          lastName,
          phone,
          specialRequests: specialReqs,
        }),
      })
      const data = await res.json()
      if (res.status === 401) { window.location.href = '/sign-in?callbackUrl=/book'; return }
      if (!res.ok) { setSubmitError(data.error ?? 'Something went wrong'); return }
      router.push(`/book/success?ref=${data.confirmationCode}`)
    } catch {
      setSubmitError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* ── Page header ── */}
      <section
        className="relative pt-32 pb-16 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #3d1209 0%, #5e1e12 50%, #6D5840 100%)' }}
      >
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: `radial-gradient(circle at 1px 1px, #FAF7F2 1px, transparent 0)`, backgroundSize: '28px 28px' }} aria-hidden="true" />
        <div className="relative z-10 container-hotel text-center">
          <p className="text-label text-[#C9A96E] mb-3">Reservations</p>
          <h1 className="text-display text-white mb-4">Book Your Stay</h1>
          <div className="w-16 h-0.5 bg-[#C9A96E] mx-auto" />
        </div>
      </section>

      {/* ── Main booking area ── */}
      <section className="py-14 bg-[#FAF7F2] min-h-screen">
        <div className="container-hotel max-w-4xl">
          <StepIndicator 
            step={step} 
            setStep={setStep} 
            roomsCount={rooms.length} 
            hasSelectedRoom={selectedRoom !== null} 
          />

          {/* ═══════════════ STEP 1 — Dates & Guests ═══════════════ */}
          {step === 1 && (
            <div className="bg-white rounded-xl border border-[#E5DDD3] shadow-[0_2px_20px_rgba(94,30,18,0.06)] p-8 md:p-14">
              <h2 className="font-serif text-3xl font-semibold text-[#2C1A12] mb-2">When are you visiting?</h2>
              <p className="text-sm text-[#6D5840] font-sans mb-10">Choose your dates and we&apos;ll show you what&apos;s available.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                {/* Check-in */}
                <div className="min-w-0">
                  <label className="block text-xs font-sans font-semibold text-[#6D5840] mb-2 uppercase tracking-wider">
                    <CalendarDays size={12} className="inline mr-1" /> Check-in
                  </label>
                  <input
                    type="date"
                    value={checkIn}
                    min={today()}
                    onChange={e => setCheckIn(e.target.value)}
                    className="w-full min-w-0 px-4 py-4 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors"
                  />
                </div>
                {/* Check-out */}
                <div className="min-w-0">
                  <label className="block text-xs font-sans font-semibold text-[#6D5840] mb-2 uppercase tracking-wider">
                    <CalendarDays size={12} className="inline mr-1" /> Check-out
                  </label>
                  <input
                    type="date"
                    value={checkOut}
                    min={checkIn}
                    onChange={e => setCheckOut(e.target.value)}
                    className="w-full min-w-0 px-4 py-4 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors"
                  />
                </div>
                {/* Guests */}
                <div className="min-w-0">
                  <label className="block text-xs font-sans font-semibold text-[#6D5840] mb-2 uppercase tracking-wider">
                    <Users size={12} className="inline mr-1" /> Guests
                  </label>
                  <select
                    value={guests}
                    onChange={e => setGuests(Number(e.target.value))}
                    className="w-full min-w-0 px-4 py-4 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors"
                  >
                    {[1,2,3,4,5,6,7,8].map(n => (
                      <option key={n} value={n}>{n} guest{n > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              {nights > 0 && (
                <p className="text-sm text-[#6D5840] font-sans">
                  <span className="font-semibold text-[#2C1A12]">{nights} night{nights > 1 ? 's' : ''}</span>
                  {' '}— {formatDate(checkIn)} to {formatDate(checkOut)}
                </p>
              )}

              {searchError && (
                <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg mt-6">
                  <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 font-sans">{searchError}</p>
                </div>
              )}

              <div className="flex items-center justify-between gap-6 mt-10 pt-8 border-t border-[#E5DDD3]">
                <p className="hidden sm:block text-xs text-[#6D5840] font-sans max-w-[220px]">No payment required yet — we&apos;ll just check what&apos;s open for your dates.</p>
                <button
                  onClick={searchAvailability}
                  disabled={loading || nights < 1}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#5e1e12] text-white font-sans font-semibold text-sm rounded hover:bg-[#7a2a1c] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shrink-0 group"
                >
                  {loading ? 'Searching…' : 'Check Available Rooms'}
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />}
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════ STEP 2 — Room Selection ═══════════════ */}
          {step === 2 && (
            <div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                <div>
                  <h2 className="font-serif text-2xl font-semibold text-[#2C1A12]">Select Your Room</h2>
                  <p className="text-sm text-[#6D5840] font-sans mt-1">
                    {nights} night{nights > 1 ? 's' : ''} · {formatDate(checkIn)} → {formatDate(checkOut)} · {guests} guest{guests > 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              <div className="space-y-5">
                {rooms.map(room => (
                  <article
                    key={room.id}
                    className={`bg-white rounded-xl border overflow-hidden shadow-sm transition-all duration-200 ${
                      selectedRoom?.id === room.id
                        ? 'border-[#5e1e12] shadow-[0_0_0_3px_rgba(94,30,18,0.12)]'
                        : 'border-[#E5DDD3] hover:shadow-md hover:border-[#5e1e12]/40'
                    }`}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-0">
                      {/* Image */}
                      <div className="relative h-48 sm:h-full">
                        <Image src={room.imagePath} alt={room.displayName} fill className="object-cover" sizes="220px" />
                      </div>
                      {/* Content */}
                      <div className="p-6 flex flex-col justify-center gap-4">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <h3 className="font-serif text-xl font-semibold text-[#2C1A12]">{room.displayName}</h3>
                          <div className="flex items-center gap-1 text-xs text-[#6D5840] font-sans">
                            <BedDouble size={13} className="text-[#5e1e12]" />
                            {room.bedConfig} · max {room.maxOccupancy} guests
                          </div>
                        </div>

                        {/* Board plan toggle */}
                        <div className="flex gap-2">
                          {(['BB', 'HB'] as MealPlan[]).map(plan => {
                            const rate = room.rates[plan]
                            if (!rate) return null
                            const active = selectedRoom?.id === room.id && selectedPlan === plan
                            return (
                              <button
                                key={plan}
                                onClick={() => { setSelectedRoom(room); setSelectedPlan(plan) }}
                                className={`flex-1 text-left rounded-lg border px-4 py-3 transition-all duration-150 ${
                                  active
                                    ? 'border-[#5e1e12] bg-[#5e1e12]/5'
                                    : 'border-[#E5DDD3] hover:border-[#5e1e12]/40'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <span className={`text-xs font-sans font-bold px-1.5 py-0.5 rounded ${active ? 'bg-[#5e1e12] text-white' : 'bg-[#E5DDD3] text-[#5e1e12]'}`}>{plan}</span>
                                    <p className="text-xs text-[#6D5840] font-sans mt-1">
                                      {plan === 'BB' ? 'Bed & Breakfast' : 'Half Board'}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="font-serif text-lg font-semibold text-[#5e1e12]">${rate.pricePerNight}<span className="text-xs font-sans font-normal text-[#6D5840]">/night</span></p>
                                    <p className="text-xs text-[#6D5840] font-sans">Total: ${rate.totalUsd}</p>
                                  </div>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <div className="mt-8 pt-6 border-t border-[#E5DDD3] flex items-center justify-between">
                <button onClick={() => setStep(1)} className="inline-flex items-center gap-2 px-6 py-3 border border-[#E5DDD3] bg-white text-[#2C1A12] font-sans font-semibold text-sm rounded-lg hover:bg-[#FAF7F2] hover:border-[#5e1e12]/30 transition-colors">
                  <ChevronLeft size={16} /> Back to Dates
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!selectedRoom}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#5e1e12] text-white font-sans font-semibold text-sm rounded hover:bg-[#7a2a1c] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 group"
                >
                  Submit Your Details
                  <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════ STEP 3 — Guest Details ═══════════════ */}
          {step === 3 && selectedRoom && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div>
                  <h2 className="font-serif text-2xl font-semibold text-[#2C1A12]">Your Details</h2>
                  <p className="text-sm text-[#6D5840] font-sans mt-1">Complete your reservation — no payment is required now.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Form */}
                <div className="lg:col-span-2">

                <div className="bg-white rounded-xl border border-[#E5DDD3] shadow-[0_2px_20px_rgba(94,30,18,0.06)] p-8 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-sans font-semibold text-[#6D5840] mb-2 uppercase tracking-wider">First Name *</label>
                      <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors" />
                    </div>
                    <div>
                      <label className="block text-xs font-sans font-semibold text-[#6D5840] mb-2 uppercase tracking-wider">Last Name *</label>
                      <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-sans font-semibold text-[#6D5840] mb-2 uppercase tracking-wider">Email Address</label>
                    <input type="email" value={guestEmail} readOnly aria-readonly="true"
                      className="w-full px-4 py-3 rounded-lg border border-[#E5DDD3] bg-[#F0EAE0] text-[#5a3d2b] font-sans text-sm cursor-not-allowed" />
                    <p className="text-xs text-[#6D5840] font-sans mt-1">Verified by Google. Your booking confirmation will be sent here.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-sans font-semibold text-[#6D5840] mb-2 uppercase tracking-wider">Phone Number</label>
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 234 567 890"
                      className="w-full px-4 py-3 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors placeholder-[#6D5840]/40" />
                  </div>
                  <div>
                    <label className="block text-xs font-sans font-semibold text-[#6D5840] mb-2 uppercase tracking-wider">Special Requests</label>
                    <textarea rows={3} value={specialReqs} onChange={e => setSpecialReqs(e.target.value)}
                      placeholder="Early check-in, extra pillows, dietary requirements, etc."
                      className="w-full px-4 py-3 rounded-lg border border-[#E5DDD3] bg-[#FAF7F2] text-[#2C1A12] font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[#5e1e12]/30 focus:border-[#5e1e12] transition-colors resize-none placeholder-[#6D5840]/40" />
                  </div>

                  {submitError && (
                    <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
                      <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700 font-sans">{submitError}</p>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-4 mt-8 pt-6 border-t border-[#E5DDD3]">
                    <button
                      onClick={() => setStep(2)}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-4 border border-[#E5DDD3] bg-white text-[#2C1A12] font-sans font-semibold text-sm rounded hover:bg-[#FAF7F2] hover:border-[#5e1e12]/30 transition-all duration-200 order-2 sm:order-1"
                    >
                      <ChevronLeft size={16} /> Back to Rooms
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || !firstName || !lastName}
                      className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#5e1e12] text-white font-sans font-semibold text-sm rounded hover:bg-[#7a2a1c] hover:shadow-[0_4px_20px_rgba(94,30,18,0.35)] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 order-1 sm:order-2"
                    >
                      {submitting ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                      {submitting ? 'Submitting your request…' : `Confirm Booking Request — USD $${selectedRate?.totalUsd?.toFixed(2)}`}
                    </button>
                  </div>
                  <p className="text-xs text-center text-[#6D5840] font-sans">No payment is taken now. Our team will contact you to confirm your reservation.</p>
                </div>
              </div>

              {/* Summary sidebar */}
              <div className="lg:col-span-1">
                <div className="h-full flex flex-col bg-white rounded-xl border border-[#E5DDD3] shadow-[0_4px_24px_rgba(94,30,18,0.08)] overflow-hidden">
                  <div className="relative h-60 shrink-0">
                    <Image src={selectedRoom.imagePath} alt={selectedRoom.displayName} fill className="object-cover" sizes="300px" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <p className="absolute bottom-3 left-3 font-serif text-white font-semibold text-lg">{selectedRoom.displayName}</p>
                  </div>
                  <div className="p-6 flex-1 flex flex-col justify-between text-sm font-sans gap-2">
                    <div className="flex justify-between text-[#5a3d2b]">
                      <span>Board plan</span>
                      <span className="font-semibold">{selectedPlan === 'BB' ? 'Bed & Breakfast' : 'Half Board'}</span>
                    </div>
                    <div className="flex justify-between text-[#5a3d2b]">
                      <span>Check-in</span>
                      <span className="font-semibold">{formatDate(checkIn)}</span>
                    </div>
                    <div className="flex justify-between text-[#5a3d2b]">
                      <span>Check-out</span>
                      <span className="font-semibold">{formatDate(checkOut)}</span>
                    </div>
                    <div className="flex justify-between text-[#5a3d2b]">
                      <span>Nights</span>
                      <span className="font-semibold">{nights}</span>
                    </div>
                    <div className="flex justify-between text-[#5a3d2b]">
                      <span>Guests</span>
                      <span className="font-semibold">{guests}</span>
                    </div>
                    <div className="flex justify-between text-[#5a3d2b]">
                      <span>Rate</span>
                      <span className="font-semibold">${selectedRate?.pricePerNight}/night</span>
                    </div>
                    <div className="border-t border-[#E5DDD3] pt-4 flex justify-between items-center">
                      <span className="font-semibold text-[#2C1A12]">Total</span>
                      <span className="font-serif text-xl font-semibold text-[#5e1e12]">USD ${selectedRate?.totalUsd?.toFixed(2)}</span>
                    </div>
                    <div>
                      <p className="text-xs text-[#6D5840] mb-1.5">✓ Best rate — book direct</p>
                      <p className="text-xs text-[#6D5840]">✓ No payment required now</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
