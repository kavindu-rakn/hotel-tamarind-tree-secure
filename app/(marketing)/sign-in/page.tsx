import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AlertCircle, LogIn } from 'lucide-react'
import { signIn } from '@/lib/auth'
import { getGuest, safeReturnPath } from '@/lib/security/guest'
import { SITE_NAME } from '@/lib/constants'

export const metadata: Metadata = {
  title: `Sign in | ${SITE_NAME}`,
  robots: { index: false },
}

// Friendly text for the error codes Auth.js can send back. Anything else gets the generic message,
// so the ?error= value from the URL is never printed on the page.
const ERRORS: Record<string, string> = {
  AccessDenied:  'Google did not confirm your email address, so we could not sign you in.',
  Configuration: 'Sign-in is not available right now. Please try again later.',
  Verification:  'That sign-in link is no longer valid. Please try again.',
}
const GENERIC_ERROR = 'Sign-in did not complete. Please try again.'

interface Props {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}

export default async function SignInPage({ searchParams }: Props) {
  const { callbackUrl, error } = await searchParams
  const returnTo = safeReturnPath(callbackUrl)

  // already signed in -> straight back to where they were going
  if (await getGuest()) redirect(returnTo)

  const configured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET)

  async function signInWithGoogle() {
    'use server'
    await signIn('google', { redirectTo: returnTo })
  }

  return (
    <>
      <section
        className="relative pt-32 pb-16 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #3d1209 0%, #5e1e12 50%, #6D5840 100%)' }}
      >
        <div className="relative z-10 container-hotel text-center">
          <p className="text-label text-[#C9A96E] mb-3">Guest account</p>
          <h1 className="text-display text-white mb-4">Sign in</h1>
          <div className="w-16 h-0.5 bg-[#C9A96E] mx-auto" />
        </div>
      </section>

      <section className="py-20 bg-[#FAF7F2]">
        <div className="container-hotel max-w-md">
          <div className="bg-white rounded-xl border border-[#E5DDD3] shadow-[0_2px_20px_rgba(94,30,18,0.06)] p-8 text-center">
            <h2 className="font-serif text-2xl font-semibold text-[#2C1A12] mb-2">Sign in to book your stay</h2>
            <p className="text-sm text-[#5a3d2b]/80 font-sans mb-6">
              We use your Google account so your booking confirmations go to an email address that really is yours.
              We only receive your name and verified email address, never your password.
            </p>

            {error && (
              <div className="flex items-start gap-2 p-3 mb-5 bg-red-50 border border-red-200 rounded-lg text-left">
                <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 font-sans">{ERRORS[error] ?? GENERIC_ERROR}</p>
              </div>
            )}

            {configured ? (
              <form action={signInWithGoogle}>
                <button
                  type="submit"
                  id="google-sign-in"
                  className="w-full inline-flex items-center justify-center gap-3 px-6 py-3.5 bg-white text-[#2C1A12] border border-[#dadce0] font-sans font-semibold text-sm rounded hover:bg-[#FAF7F2] hover:border-[#5e1e12]/40 transition-colors"
                >
                  <LogIn size={17} aria-hidden="true" />
                  Continue with Google
                </button>
              </form>
            ) : (
              <p className="text-sm text-[#6D5840] font-sans">
                Google sign-in is not set up on this server yet. Please contact the hotel to book by phone or email.
              </p>
            )}

            <p className="text-xs text-[#6D5840] font-sans mt-6">
              Hotel staff sign in <a href="/admin/login" className="underline hover:text-[#5e1e12]">here</a>.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
