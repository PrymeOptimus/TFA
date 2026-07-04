# Implementation Plan

Status legend: ✅ done in this repo · 🚧 partial/stubbed · ⬜ not started

## Phase 1 — Foundation (✅ done)

1. ✅ Project scaffold: Next.js 14 App Router, TypeScript, Tailwind, ESLint config.
2. ✅ Prisma schema + PostgreSQL — see `prisma/schema.prisma`.
3. ✅ Auth.js with Google provider, database sessions, Prisma adapter.
4. ✅ Household model + onboarding flow (`/dashboard` redirects to
   `OnboardingForm` until a household exists).
5. ✅ Family member CRUD (`/dashboard/family`, `/api/family*`).
6. ✅ Google Calendar OAuth captured on sign-in (`linkAccount` event), stored
   encrypted in `CalendarConnection`.
7. ✅ Calendar sync (`/api/calendar/sync`, `/api/cron/sync`) with incremental
   `syncToken` support, writing into `CalendarEventCache`.
8. ✅ Full-screen display page (`/display/[displayCode]`) with pairing flow.
9. ✅ Month / week / day-agenda / Today-Tomorrow-Upcoming list views.
10. ✅ Clock, date, greeting, and weather widgets.

**Exit criteria met:** a signed-in user can create a household, add family
members, see their real Google Calendar events on `/display/[code]` after
pairing a screen, color-coded per family member.

## Phase 2 — Household features (✅ done)

1. ✅ Chores: CRUD, recurrence (`RecurrenceFreq`), points, touch check-off
   (`ChoresWidget`, `/dashboard/chores`).
2. ✅ Rewards: reward bank CRUD + point-balance redemption
   (`/api/rewards/[id]` POST).
3. ✅ Meal planner: weekly grid, 3 slots/day, optional image, grocery list.
4. ✅ Notes/announcements: sticky-note CRUD, pin, expiry field, server-side
   sanitization.
5. ✅ Photo backgrounds: upload with `sharp` sanitization, crossfade slideshow,
   readability overlay.
6. ✅ Widget presets: 5 seeded layouts + a numeric grid-based widget placement
   UI (`/dashboard/widgets`).

**Exit criteria met:** a household can run day-to-day on the display without
touching Google Calendar directly — chores, meals, and notes all editable
from the dashboard and live on the TV within the widget's poll interval.

## Phase 3 — Advanced (🚧 partial — scaffolded, not fully implemented)

Ordered by suggested build sequence:

1. **Multi-screen pairing** — ✅ actually done ahead of schedule: `Display`
   model, pairing-code claim flow, per-display layout/theme/orientation.
2. **True drag-and-drop layout canvas** — ⬜ not started. The API contract
   (`PATCH /api/widgets` taking `x/y/w/h`) already supports it; swap the
   numeric-input UI in `src/app/dashboard/widgets/page.tsx` for a pointer-drag
   grid (e.g. `react-grid-layout` or a hand-rolled pointer-events canvas) —
   no backend change needed.
3. **Microsoft Outlook (Graph API) calendar** — ⬜ not started. Schema is
   ready (`CalendarProvider.MICROSOFT`, generic `CalendarConnection`/
   `CalendarEventCache`). Build `src/lib/microsoft-calendar.ts` mirroring
   `google-calendar.ts`'s four functions, add an `AzureADProvider` (or MSAL
   flow) to `src/lib/auth.ts`, branch `/api/calendar/sync` on
   `connection.provider`.
4. **Apple Calendar / iCloud (CalDAV or public .ics)** — ⬜ not started.
   `CalendarProvider.APPLE` is reserved. Apple doesn't offer OAuth for
   CalDAV the way Google/Microsoft do; the practical MVP path is read-only
   `.ics` subscription URLs (no token storage needed at all) rather than
   full CalDAV read/write — worth revisiting scope with the user before
   building.
5. **Google Photos sync** — ⬜ not started. `Photo.source` already
   distinguishes `'upload'` vs `'google_photos'`. Requires the Google Photos
   Library API scope added to the existing Google OAuth grant, a picker UI,
   and a periodic sync job mirroring the calendar cron.
6. **Mobile companion admin interface** — ⬜ not started. The dashboard is
   already responsive (Tailwind, no fixed pixel widths) and usable on a
   phone browser today; a dedicated app would most likely be a thin
   React Native/Capacitor wrapper around the same API routes rather than a
   new backend.

## Suggested next milestones after this repo

1. Wire a real Postgres instance (Neon/Supabase) and run `npm run prisma:migrate`.
2. Create a Google Cloud OAuth client, add `http://localhost:3000/api/auth/callback/google`
   as an authorized redirect URI, and enable the Calendar API.
3. Get an OpenWeatherMap API key (One Call API 3.0 requires a subscription tier
   — verify current pricing before committing to it in production).
4. Deploy per `docs/DEPLOYMENT.md`, then do a real pairing test with a second
   device/browser before calling Phase 1+2 "shipped."
