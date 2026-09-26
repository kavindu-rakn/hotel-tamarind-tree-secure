// app/api/availability/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { findAvailableRoomTypes } from '@/lib/booking-utils'
import { enumToUrlSlug, getRoomImagePath } from '@/lib/utils'
import { isoDay, checkStay, MAX_MAX_OCCUPANCY } from '@/lib/validation/booking'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const checkInStr  = searchParams.get('checkIn')
  const checkOutStr = searchParams.get('checkOut')
  const guestsStr   = searchParams.get('guests') ?? '1'

  if (!checkInStr || !checkOutStr) {
    return NextResponse.json({ error: 'checkIn and checkOut are required' }, { status: 400 })
  }

  // V04: same date rules as the booking endpoint (real dates, not in the past, at most 30 nights).
  // The original accepted any range, so ?checkOut=9999-12-31 made the server compute 2.9 million "nights".
  if (!isoDay.safeParse(checkInStr).success || !isoDay.safeParse(checkOutStr).success) {
    return NextResponse.json({ error: 'Dates must be written like 2026-12-31.' }, { status: 400 })
  }
  const stayProblem = checkStay(checkInStr, checkOutStr)
  if (stayProblem) return NextResponse.json({ error: stayProblem }, { status: 400 })

  const guests = /^\d{1,2}$/.test(guestsStr) ? parseInt(guestsStr, 10) : NaN
  if (!(guests >= 1 && guests <= MAX_MAX_OCCUPANCY)) {
    return NextResponse.json({ error: `Guests must be between 1 and ${MAX_MAX_OCCUPANCY}` }, { status: 400 })
  }

  const checkIn  = new Date(`${checkInStr}T00:00:00Z`)
  const checkOut = new Date(`${checkOutStr}T00:00:00Z`)

  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))

  let roomTypes
  try {
    roomTypes = await findAvailableRoomTypes(checkIn, checkOut, guests)
  } catch (err) {
    console.error('[availability] database error:', err)
    return NextResponse.json({ error: 'Search failed. Please try again in a moment.' }, { status: 503 })
  }

  const results = roomTypes.map(rt => {
    const urlSlug = enumToUrlSlug(rt.slug) ?? rt.slug.toLowerCase()
    const bbPlan = rt.ratePlans.find(p => p.mealPlan === 'BB')
    const hbPlan = rt.ratePlans.find(p => p.mealPlan === 'HB')
    return {
      id:           rt.id,
      slug:         urlSlug,
      enumSlug:     rt.slug,
      displayName:  rt.displayName,
      maxOccupancy: rt.maxOccupancy,
      bedConfig:    rt.bedConfig,
      imagePath:    getRoomImagePath(urlSlug),
      firstUnitId:  rt.units[0]?.id ?? null,
      nights,
      rates: {
        BB: bbPlan ? { id: bbPlan.id, pricePerNight: Number(bbPlan.priceUsd), totalUsd: Number(bbPlan.priceUsd) * nights } : null,
        HB: hbPlan ? { id: hbPlan.id, pricePerNight: Number(hbPlan.priceUsd), totalUsd: Number(hbPlan.priceUsd) * nights } : null,
      },
    }
  })

  return NextResponse.json({ results, checkIn: checkInStr, checkOut: checkOutStr, guests, nights })
}
