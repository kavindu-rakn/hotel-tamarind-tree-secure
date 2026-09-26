'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireRole, STAFF_ROLES, ADMIN_ONLY } from '@/lib/security/authz'
import { parseInput, idSchema, roomTypeUpdateSchema, ratePlanUpdateSchema, blockedDateSchema } from '@/lib/validation/admin'

export async function updateRoomType(id: string, data: {
  displayName: string
  description: string
  bedConfig: string
  maxOccupancy: number
  sizeSqm: number | null
  isActive: boolean
}) {
  const ctx = await requireRole(ADMIN_ONLY, 'room_type.update')
  id = parseInput(idSchema, id)
  data = parseInput(roomTypeUpdateSchema, data)
  await db.roomType.update({
    where: { id },
    data: {
      displayName:  data.displayName,
      description:  data.description || null,
      bedConfig:    data.bedConfig,
      maxOccupancy: data.maxOccupancy,
      sizeSqm:      data.sizeSqm,
      isActive:     data.isActive,
    },
  })
  await ctx.log('admin.room_type.update', `roomType:${id}`, { displayName: data.displayName, isActive: data.isActive })
  revalidatePath('/admin/rooms')
}

export async function updateRatePlan(id: string, data: {
  priceUsd: number
  isVisible: boolean
  isRefundable: boolean
  cancellationPolicy: string
}) {
  const ctx = await requireRole(ADMIN_ONLY, 'rate_plan.update')
  id = parseInput(idSchema, id)
  data = parseInput(ratePlanUpdateSchema, data)
  const before = await db.ratePlan.findUnique({ where: { id }, select: { priceUsd: true } })
  await db.ratePlan.update({
    where: { id },
    data: {
      priceUsd:           data.priceUsd,
      isVisible:          data.isVisible,
      isRefundable:       data.isRefundable,
      cancellationPolicy: data.cancellationPolicy || null,
    },
  })
  await ctx.log('admin.rate_plan.update', `ratePlan:${id}`, { oldPriceUsd: before ? Number(before.priceUsd) : null, newPriceUsd: data.priceUsd })
  revalidatePath('/admin/rooms')
}

export async function toggleUnitActive(id: string, isActive: boolean) {
  const ctx = await requireRole(ADMIN_ONLY, 'room_unit.toggle_active')
  id = parseInput(idSchema, id)
  isActive = parseInput(z.boolean(), isActive)
  await db.roomUnit.update({ where: { id }, data: { isActive } })
  await ctx.log('admin.room_unit.toggle_active', `roomUnit:${id}`, { isActive })
  revalidatePath('/admin/rooms')
}

export async function addBlockedDate(input: { roomUnitId: string; startDate: string; endDate: string; reason: string }) {
  const ctx = await requireRole(STAFF_ROLES, 'blocked_date.add')
  input = parseInput(blockedDateSchema, input)
  const start = new Date(`${input.startDate}T00:00:00Z`)
  const end   = new Date(`${input.endDate}T00:00:00Z`)

  await db.blockedDate.create({
    data: { roomUnitId: input.roomUnitId, startDate: start, endDate: end, reason: input.reason || null },
  })
  await ctx.log('admin.blocked_date.add', `roomUnit:${input.roomUnitId}`, { start: input.startDate, end: input.endDate })
  revalidatePath('/admin/rooms')
}

export async function removeBlockedDate(id: string) {
  const ctx = await requireRole(STAFF_ROLES, 'blocked_date.remove')
  id = parseInput(idSchema, id)
  await db.blockedDate.delete({ where: { id } })
  await ctx.log('admin.blocked_date.remove', `blockedDate:${id}`)
  revalidatePath('/admin/rooms')
}
