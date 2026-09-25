import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import RoomTypeCard from './RoomTypeCard'

export default async function AdminRoomsPage() {
  // prices and the room catalogue are administrator-only (V09); staff are sent back to the overview
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') redirect('/admin')

  const roomTypes = await db.roomType.findMany({
    include: {
      ratePlans: { orderBy: { mealPlan: 'asc' } },
      units: {
        orderBy: { unitNumber: 'asc' },
        include: {
          blockedDates: { orderBy: { startDate: 'asc' } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return (
    <div>
      <h1 className="font-serif text-3xl font-semibold text-[#2C1A12] mb-1">Rooms</h1>
      <p className="text-sm text-[#6D5840] font-sans mb-8">Manage room types, rates, units, and maintenance blocks.</p>

      <div className="space-y-6">
        {roomTypes.map(rt => (
          <RoomTypeCard
            key={rt.id}
            roomType={{
              id:           rt.id,
              displayName:  rt.displayName,
              description:  rt.description ?? '',
              bedConfig:    rt.bedConfig,
              maxOccupancy: rt.maxOccupancy,
              sizeSqm:      rt.sizeSqm ? Number(rt.sizeSqm) : null,
              isActive:     rt.isActive,
            }}
            ratePlans={rt.ratePlans.map(rp => ({
              id:                 rp.id,
              mealPlan:           rp.mealPlan,
              priceUsd:           Number(rp.priceUsd),
              isVisible:          rp.isVisible,
              isRefundable:       rp.isRefundable,
              cancellationPolicy: rp.cancellationPolicy ?? '',
            }))}
            units={rt.units.map(u => ({
              id:         u.id,
              unitNumber: u.unitNumber,
              floor:      u.floor,
              isActive:   u.isActive,
              blockedDates: u.blockedDates.map(bd => ({
                id:        bd.id,
                startDate: bd.startDate.toISOString(),
                endDate:   bd.endDate.toISOString(),
                reason:    bd.reason ?? '',
              })),
            }))}
          />
        ))}
      </div>
    </div>
  )
}
