// Works out the visitor's IP address for rate limiting and audit logs.
//
// Never trust `X-Forwarded-For` blindly: any client can send it and pretend to be a new IP on every
// request, which would make per-IP rate limits useless. So we only read a header that WE know is
// written by our own infrastructure:
//   - on Vercel: x-vercel-forwarded-for / x-real-ip are set by Vercel's edge and cannot be forged
//   - elsewhere: only if TRUSTED_PROXY_HEADER names a header set by a proxy we control
//     (the local test setup uses x-forwarded-for so tests can pretend to be different visitors)
// Otherwise we return "unknown" and the per-account limits still apply.
const SAFE_IP = /^[0-9a-fA-F:.]{3,45}$/

export function getClientIp(headers: Headers): string {
  const candidates: (string | null)[] = []
  if (process.env.VERCEL) candidates.push(headers.get('x-vercel-forwarded-for'), headers.get('x-real-ip'))
  else if (process.env.TRUSTED_PROXY_HEADER) candidates.push(headers.get(process.env.TRUSTED_PROXY_HEADER))

  for (const value of candidates) {
    const first = value?.split(',')[0]?.trim()
    if (first && SAFE_IP.test(first)) return first
  }
  return 'unknown'
}
