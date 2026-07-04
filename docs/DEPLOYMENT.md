# Deployment

Target stack: **Vercel** (frontend + API routes) + **Neon or Supabase**
(managed PostgreSQL). Everything below assumes that pairing; swapping either
piece is possible without code changes as long as the replacement speaks
standard Postgres / is a Node.js host that supports Next.js.

## 1. Database

1. Create a Postgres instance (Neon: `neon.tech`, or Supabase: `supabase.com`).
2. Copy the connection string into `DATABASE_URL`. Use the **pooled**
   connection string if your host offers one (Neon's pooler, or Supabase's
   `pgbouncer` port) — serverless functions open many short-lived
   connections and Prisma's own pool doesn't survive across invocations.
3. Run migrations against it:
   ```bash
   DATABASE_URL="..." npx prisma migrate deploy
   ```

## 2. Google OAuth credentials

1. In Google Cloud Console, create an OAuth 2.0 Client ID (Web application).
2. Authorized redirect URI: `https://<your-domain>/api/auth/callback/google`.
3. Enable the **Google Calendar API** for the project.
4. Under OAuth consent screen, add the two Calendar scopes used in
   `src/lib/auth.ts` (`calendar.readonly`, `calendar.events`) — while in
   "Testing" publishing status, only added test users can complete sign-in,
   so add your household's Google accounts there, or submit for verification
   before wider use.
5. Put the client ID/secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## 3. Secrets

```bash
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY  (must decode to exactly 32 bytes)
openssl rand -hex 24      # CRON_SECRET
```

## 4. Weather

Sign up at OpenWeatherMap and confirm your plan includes the "One Call API
3.0" endpoint used in `src/lib/weather.ts` (it's a separate subscription from
the legacy free tier as of this writing) — verify current terms before
launch. `WEATHER_PROVIDER=openweathermap` is the only implemented provider;
`getWeather()`'s return shape is provider-agnostic if you swap in
WeatherAPI.com instead.

## 5. Photo storage

`STORAGE_DRIVER=local` (default) writes to `public/uploads/` on the running
instance's filesystem — **this does not persist across Vercel deployments or
scale across multiple serverless instances.** Before going to production,
either:

- Set `STORAGE_DRIVER=supabase` and fill in `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET`, or
- Set `STORAGE_DRIVER=s3` and fill in the `S3_*` variables,

then implement the corresponding branch in `src/lib/storage.ts`'s
`saveHouseholdPhoto()` (the function signature and sanitize-then-upload flow
are already in place — only the "where do the bytes go" branch is stubbed).

## 6. Deploy to Vercel

```bash
vercel link
vercel env add DATABASE_URL
vercel env add NEXTAUTH_URL          # https://<your-domain>
vercel env add NEXTAUTH_SECRET
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add TOKEN_ENCRYPTION_KEY
vercel env add OPENWEATHER_API_KEY
vercel env add CRON_SECRET
# ...and any storage vars from step 5
vercel --prod
```

## 7. Scheduled calendar sync

`/api/cron/sync` is the endpoint; it's not scheduled by itself. Add a Vercel
Cron job in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/sync", "schedule": "*/15 * * * *" }
  ]
}
```

Vercel Cron doesn't let you set custom headers, so either (a) accept that
`/api/cron/sync` is reachable by anyone who knows the URL and rely on
`CRON_SECRET` being unguessable as the only gate (acceptable for most
households, since the endpoint only *syncs*, it doesn't leak data), or (b)
front it with a small Vercel Middleware / Edge Config check, or (c) call it
from an external scheduler (GitHub Actions, cron-job.org) that *can* set the
`Authorization: Bearer $CRON_SECRET` header. Option (c) is recommended for
anything beyond a personal/family deployment.

## 8. Post-deploy smoke test

Walk through `docs/TESTING_CHECKLIST.md`'s "Smoke test" section against the
live URL before considering the deploy done — in particular, pairing a
*second* browser/device as a display, since that flow can't be exercised
from `localhost` alone in the same way it will be used in practice.
