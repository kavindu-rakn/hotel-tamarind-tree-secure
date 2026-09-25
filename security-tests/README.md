# Security regression tests

One script that re-runs every attack proven against the original Hotel Tamarind Tree code
(V01-V13 in the report). Each test prints `[VULNERABLE]` or `[PROTECTED]`.

**Run it only against a LOCAL copy.** It creates test users, bookings and messages, and it
refuses to start if `DATABASE_URL` is not a local database.

```bash
# terminal 1: fake mail server (captures emails, nothing is really sent)
pnpm test:mail                      # listens on 127.0.0.1:4010

# terminal 2: the app, built and started with these extra env vars in .env.local
#   RESEND_API_KEY=re_fake  RESEND_BASE_URL=http://127.0.0.1:4010
#   TRUSTED_PROXY_HEADER=x-forwarded-for   (lets the tests pretend to be different IPs)
pnpm build && pnpm start

# terminal 3
pnpm test:security                  # all tests
pnpm test:security V07 V09          # only some
```

Extra switches: `BASE_URL`, `LEGACY_API=1` (original API shape with an `email` field),
`CRON_UNSET_URL` (an instance started without `CRON_SECRET`, for V02), `MAIL_LOG`, `NEXT_DIR`.

The Google sign-in cannot be automated, so the tests mint a guest session cookie with
`AUTH_SECRET` (the same thing Auth.js does after a real sign-in).
