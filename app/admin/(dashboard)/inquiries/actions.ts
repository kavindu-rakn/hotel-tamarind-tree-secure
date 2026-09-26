'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { z } from 'zod'
import { requireRole, STAFF_ROLES, ADMIN_ONLY } from '@/lib/security/authz'
import { parseInput, idSchema } from '@/lib/validation/admin'

export async function toggleInquiryRead(id: string, isRead: boolean) {
  await requireRole(STAFF_ROLES, 'inquiry.toggle_read')
  id = parseInput(idSchema, id)
  isRead = parseInput(z.boolean(), isRead)
  await db.inquiry.update({ where: { id }, data: { isRead } })
  revalidatePath('/admin/inquiries')
  revalidatePath('/admin')
}

export async function deleteInquiry(id: string) {
  // deleting customer messages is destructive, so it is limited to ADMIN
  const ctx = await requireRole(ADMIN_ONLY, 'inquiry.delete')
  id = parseInput(idSchema, id)
  await db.inquiry.delete({ where: { id } })
  await ctx.log('admin.inquiry.delete', `inquiry:${id}`)
  revalidatePath('/admin/inquiries')
  revalidatePath('/admin')
}
