// lib/security/html.ts
// Turn text into something that is safe to drop inside an HTML email.
// Without this, whatever a guest typed (a name, "special requests") was pasted into the HTML as-is, so a
// guest could put a link or an image in the message and it would appear, looking official, inside the
// hotel's own emails (HTML injection / phishing, OWASP A03).
const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, ch => MAP[ch])
}
