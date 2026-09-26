// lib/security/request.ts
// Safe handling of incoming API requests: size limit, content type, same-site check.
import { NextResponse } from 'next/server'

type Read =
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse }

const fail = (status: number, error: string): Read => ({ ok: false, response: NextResponse.json({ error }, { status }) })

/**
 * Read a JSON request body, but never more than `maxBytes`.
 * The original called req.json() on whatever arrived, so a multi-megabyte body was read into memory
 * and stored in the database (V04 / V06). Here the size is checked from the header first and again
 * while reading, so a client that lies about its size is cut off too.
 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<Read> {
  const type = req.headers.get('content-type') ?? ''
  if (!/^application\/json\b/i.test(type)) return fail(415, 'Send the request as application/json.')

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) return fail(413, 'Request is too large.')

  if (!req.body) return fail(400, 'Request body is empty.')
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return fail(413, 'Request is too large.') }
    chunks.push(value)
  }
  try {
    return { ok: true, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return fail(400, 'Request body is not valid JSON.')
  }
}

/**
 * Browsers attach an Origin header to cross-site POSTs. If it is present and points somewhere other than
 * this site, refuse: another website is trying to act as the signed-in visitor (CSRF).
 * Requests with no Origin header (scripts, curl, server-to-server) are not browsers being tricked, so they pass.
 */
export function crossSiteBlock(req: Request): NextResponse | null {
  const origin = req.headers.get('origin')
  if (!origin) return null
  let originHost: string
  try { originHost = new URL(origin).host } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const siteHost = new URL(req.url).host
  return originHost === siteHost ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
