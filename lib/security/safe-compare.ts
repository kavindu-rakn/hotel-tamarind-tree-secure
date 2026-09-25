import { createHash, timingSafeEqual } from 'node:crypto'

// Compare two secrets without leaking, through response time, how many leading characters matched.
// Both values are hashed first so the buffers always have the same length (timingSafeEqual needs that).
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
