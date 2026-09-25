'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NAV_LINKS } from '@/lib/constants'
import AccountMenu from './AccountMenu'

export default function Header() {
  const [isScrolled,     setIsScrolled]     = useState(false)
  const [isMobileOpen,   setIsMobileOpen]   = useState(false)
  const pathname = usePathname()

  // Detect scroll to toggle solid background
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close mobile nav on route change
  useEffect(() => {
    setIsMobileOpen(false)
  }, [pathname])

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        isScrolled || isMobileOpen
          ? 'bg-[#FAF7F2] shadow-[0_2px_24px_rgba(94,30,18,0.10)]'
          : 'bg-transparent'
      )}
    >
      <div className="container-hotel">
        <div className="flex items-center justify-between h-20">

          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5e1e12] rounded"
            aria-label="Hotel Tamarind Tree — Home"
          >
            <Image
              src="/logo.png"
              alt="Hotel Tamarind Tree logo"
              width={44}
              height={44}
              className={cn(
                "object-contain transition-all duration-300 group-hover:scale-105",
                !(isScrolled || isMobileOpen) && "brightness-0 invert"
              )}
              priority
            />
            <div className="hidden sm:block leading-tight">
              <span
                className={cn(
                  'block text-[0.65rem] font-sans font-semibold tracking-[0.18em] uppercase transition-colors duration-300',
                  isScrolled ? 'text-[#6D5840]' : 'text-[#FAF7F2]'
                )}
              >
                HOTEL
              </span>
              <span
                className={cn(
                  'block font-serif text-xl font-semibold transition-colors duration-300',
                  isScrolled ? 'text-[#5e1e12]' : 'text-white'
                )}
              >
                Tamarind Tree
              </span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1" aria-label="Main navigation">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'relative px-3 py-1.5 text-sm font-sans font-medium transition-colors duration-200 rounded',
                  'after:absolute after:bottom-0 after:left-3 after:right-3 after:h-px after:bg-[#C9A96E] after:scale-x-0 after:transition-transform after:duration-200 hover:after:scale-x-100',
                  pathname === link.href ? 'after:scale-x-100' : '',
                  isScrolled
                    ? 'text-[#5a3d2b] hover:text-[#5e1e12]'
                    : 'text-white/90 hover:text-white'
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* CTA + Mobile toggle */}
          <div className="flex items-center gap-4">
            <AccountMenu solid={isScrolled || isMobileOpen} className="hidden sm:inline-flex" />
            <Link
              href="/book"
              id="header-book-now-btn"
              className={cn(
                'hidden sm:inline-flex items-center px-5 py-2.5 rounded text-sm font-sans font-semibold transition-all duration-200',
                'bg-[#5e1e12] text-white hover:bg-[#7a2a1c] hover:shadow-[0_4px_16px_rgba(94,30,18,0.35)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5e1e12] focus-visible:ring-offset-2'
              )}
            >
              Book Now
            </Link>

            {/* Mobile menu toggle */}
            <button
              id="mobile-menu-toggle"
              onClick={() => setIsMobileOpen(v => !v)}
              className={cn(
                'lg:hidden p-2 rounded transition-colors duration-200',
                isScrolled || isMobileOpen
                  ? 'text-[#5e1e12] hover:bg-[#F0EAE0]'
                  : 'text-white hover:bg-white/10'
              )}
              aria-label={isMobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileOpen}
            >
              {isMobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      <div
        id="mobile-nav"
        className={cn(
          'lg:hidden overflow-hidden transition-all duration-300 ease-in-out',
          isMobileOpen ? 'max-h-screen opacity-100' : 'max-h-0 opacity-0'
        )}
        aria-hidden={!isMobileOpen}
      >
        <nav
          className="container-hotel pb-6 flex flex-col gap-1 border-t border-[#E5DDD3]"
          aria-label="Mobile navigation"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'py-3 px-2 text-base font-sans font-medium border-b border-[#E5DDD3] transition-colors duration-150',
                pathname === link.href
                  ? 'text-[#5e1e12] font-semibold'
                  : 'text-[#5a3d2b] hover:text-[#5e1e12]'
              )}
            >
              {link.label}
            </Link>
          ))}
          <AccountMenu solid className="py-3 px-2" />
          <Link
            href="/book"
            className="mt-3 inline-flex justify-center items-center px-5 py-3 rounded bg-[#5e1e12] text-white font-sans font-semibold text-sm hover:bg-[#7a2a1c] transition-colors duration-200"
          >
            Book Now
          </Link>
        </nav>
      </div>
    </header>
  )
}
