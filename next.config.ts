import type { NextConfig } from "next";

// ─── Security headers (V01, OWASP A05) ───────────────────────────────────────
// The original app sent none of these. Each one closes a specific browser-side attack:
//   Content-Security-Policy   -> the browser only loads scripts/images/frames from places we list
//   Strict-Transport-Security -> the browser refuses plain http for 2 years (stops downgrade attacks)
//   X-Frame-Options / frame-ancestors -> nobody can put our site inside their page (clickjacking)
//   X-Content-Type-Options    -> the browser must trust our Content-Type (stops MIME sniffing)
//   Referrer-Policy           -> booking references in URLs are not leaked to other sites
//   Permissions-Policy        -> camera, microphone, location etc. are switched off
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js injects small inline bootstrap scripts, so 'unsafe-inline' is needed unless every page
  // is rendered dynamically with a per-request nonce (would break static/ISR pages). Documented
  // as a partly-mitigated risk in the report. 'unsafe-eval' is only allowed for `next dev`.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://www.google.com", // Google Maps embed on the About page
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  // accounts.google.com: the "Continue with Google" form is answered with a redirect to Google. Browsers
  // apply form-action to that redirect too, so Google has to be listed or the sign-in would be blocked.
  "form-action 'self' https://accounts.google.com",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Do not advertise the framework in every response (X-Powered-By: Next.js)
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
  experimental: {
    // Enable server actions (needed for form handling)
  },
};

export default nextConfig;
