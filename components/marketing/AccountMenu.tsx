'use client'

// Small "Sign in / your name" control for the public header.
// It asks /api/auth/session in the browser instead of reading cookies on the server, so the public
// marketing pages stay static (fast, cacheable) and only this little widget depends on who you are.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { LogIn, LogOut, User } from 'lucide-react'
import { cn } from '@/lib/utils'

type Me = { name?: string | null; email?: string | null; role?: string } | null

export default function AccountMenu({ solid, className }: { solid: boolean; className?: string }) {
  const [me, setMe] = useState<Me | undefined>(undefined) // undefined = still loading

  useEffect(() => {
    let alive = true
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) setMe(j?.user ?? null) })
      .catch(() => { if (alive) setMe(null) })
    return () => { alive = false }
  }, [])

  const tone = solid ? 'text-[#5a3d2b] hover:text-[#5e1e12]' : 'text-white/90 hover:text-white'

  if (me === undefined) return <span className={cn('w-16', className)} aria-hidden="true" />

  // Only guests get this menu. Staff have their own console at /admin.
  if (!me || me.role !== 'GUEST') {
    return (
      <Link href="/sign-in" className={cn('inline-flex items-center gap-1.5 text-sm font-sans font-medium transition-colors', tone, className)}>
        <LogIn size={15} /> Sign in
      </Link>
    )
  }

  const first = (me.name ?? me.email ?? 'Guest').split(' ')[0]
  return (
    <div className={cn('inline-flex items-center gap-3 text-sm font-sans font-medium', className)}>
      <Link href="/account" className={cn('inline-flex items-center gap-1.5 transition-colors', tone)}>
        <User size={15} /> {first}
      </Link>
      <button
        type="button"
        onClick={() => signOut({ redirectTo: '/' })}
        className={cn('inline-flex items-center gap-1 transition-colors', tone)}
        aria-label="Sign out"
      >
        <LogOut size={15} />
      </button>
    </div>
  )
}
