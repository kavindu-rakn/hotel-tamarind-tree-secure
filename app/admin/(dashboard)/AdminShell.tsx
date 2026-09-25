'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, CalendarCheck, BedDouble, Mail, LogOut, Menu, X } from 'lucide-react'

const NAV: { label: string; href: string; icon: typeof Mail; adminOnly?: boolean }[] = [
  { label: 'Overview',  href: '/admin',           icon: LayoutDashboard },
  { label: 'Bookings',  href: '/admin/bookings',  icon: CalendarCheck },
  { label: 'Rooms',     href: '/admin/rooms',     icon: BedDouble, adminOnly: true },
  { label: 'Inquiries', href: '/admin/inquiries', icon: Mail },
]

function isActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)
}

export default function AdminShell({
  userEmail,
  role,
  signOutAction,
  children,
}: {
  userEmail: string
  role: string
  signOutAction: () => Promise<void>
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-[#FAF7F2] lg:flex">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-20 flex items-center gap-3 bg-[#2C1A12] text-white px-4 h-14">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="-ml-1 p-1 rounded hover:bg-white/10">
          <Menu size={22} />
        </button>
        <p className="font-serif text-base">Staff Admin</p>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-[#2C1A12] text-white flex-col">
        <SidebarBody pathname={pathname} userEmail={userEmail} role={role} signOutAction={signOutAction} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 max-w-[80%] bg-[#2C1A12] text-white flex flex-col shadow-xl">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute top-4 right-4 p-1 rounded text-white/70 hover:bg-white/10 hover:text-white"
            >
              <X size={20} />
            </button>
            <SidebarBody
              pathname={pathname}
              userEmail={userEmail}
              role={role}
              signOutAction={signOutAction}
              onNavigate={() => setOpen(false)}
            />
          </aside>
        </div>
      )}

      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  )
}

function SidebarBody({
  pathname,
  userEmail,
  role,
  signOutAction,
  onNavigate,
}: {
  pathname: string
  userEmail: string
  role: string
  signOutAction: () => Promise<void>
  onNavigate?: () => void
}) {
  return (
    <>
      <div className="px-6 py-6 border-b border-white/10">
        <p className="text-[10px] font-sans font-semibold tracking-widest text-[#C9A96E] uppercase">Hotel Tamarind Tree</p>
        <p className="font-serif text-lg">Staff Admin</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.filter(n => !n.adminOnly || role === 'ADMIN').map(({ label, href, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-sans transition-colors ${
                active ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={17} />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="px-6 py-4 border-t border-white/10">
        <p className="text-xs font-sans text-white/50 truncate">{userEmail}</p>
        <p className="text-[10px] font-sans tracking-widest uppercase text-[#C9A96E] mb-2">{role === 'ADMIN' ? 'Administrator' : 'Staff'}</p>
        <form action={signOutAction}>
          <button type="submit" className="flex items-center gap-2 text-sm font-sans text-white/70 hover:text-white transition-colors">
            <LogOut size={15} /> Sign Out
          </button>
        </form>
      </div>
    </>
  )
}
