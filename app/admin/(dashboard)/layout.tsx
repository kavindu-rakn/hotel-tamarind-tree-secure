import { redirect } from 'next/navigation'
import { auth, signOut } from '@/lib/auth'
import AdminShell from './AdminShell'

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  // defence in depth: the proxy already blocks these, but the page re-checks in case the proxy is ever bypassed
  if (!session?.user || !['ADMIN', 'STAFF'].includes(session.user.role)) redirect('/admin/login')

  async function signOutAction() {
    'use server'
    await signOut({ redirectTo: '/admin/login' })
  }

  return (
    <AdminShell userEmail={session.user.email ?? ''} role={session.user.role} signOutAction={signOutAction}>
      {children}
    </AdminShell>
  )
}
