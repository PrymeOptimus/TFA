# Architecture

## 1. Overview

Hearth is a single Next.js 14 App Router application serving three distinct surfaces
from one codebase:

1. **Dashboard** (`/dashboard/*`) — authenticated, per-household admin UI. Household
   members log in, configure family members, chores, meals, calendars, and displays.
2. **Display** (`/display/[displayCode]`) — unauthenticated, kiosk-mode full-screen
   view meant to run for days/weeks on a TV or tablet browser. Trust boundary is the
   long random `displayCode` itself (an unlisted-URL capability token), not a login
   session — kiosk devices don't have user accounts.
3. **API routes** (`/api/*`) — Next.js Route Handlers backing both surfaces, plus a
   `/api/cron/sync` endpoint for scheduled Google Calendar sync.

```
┌─────────────────┐        ┌──────────────────────┐        ┌────────────────┐
│  Admin browser   │──────▶│  /dashboard/*  (auth)  │──────▶│                 │
└─────────────────┘        └──────────────────────┘        │   API routes    │
┌─────────────────┐        ┌──────────────────────┐        │  (Route         │──▶ PostgreSQL (Prisma)
│  Kiosk / TV      │──────▶│ /display/[code] (open) │──────▶│   Handlers)     │
└─────────────────┘        └──────────────────────┘        │                 │──▶ Google Calendar API
                                                              └────────────────┘──▶ OpenWeatherMap
```

## 2. Tenant model: Household

Every piece of data hangs off a `Household` — the tenant boundary. A `User` (login
account) can belong to multiple households via `HouseholdMember` (with a role:
OWNER/ADMIN/MEMBER). A `FamilyMember` is a *person shown on the display* (kids,
non-login family) and is distinct from a `User` (a person who can sign in). This
split matters: you don't want to create a Google account for a 6-year-old just so
they can have a color and an avatar on the fridge display.

Every API route that touches household data calls `requireHouseholdAccess(householdId)`
(`src/lib/session-context.ts`) first — this is the single enforcement point for
"can this signed-in user see/edit this household's data." It throws a typed
`UnauthorizedError`/`ForbiddenError` that the shared `apiErrorResponse()` helper
turns into the right HTTP status.

## 3. Auth

Auth.js (NextAuth v4) with the Google provider and a database session strategy
(sessions live in Postgres via `@auth/prisma-adapter`, not JWTs — this makes
revocation and "sign out everywhere" trivial). Google OAuth scope is requested
up front (`openid email profile` + Calendar readonly + Calendar events), so the
same consent screen that logs someone in also captures a calendar grant — see
`src/lib/auth.ts`'s `linkAccount` event, which persists the resulting tokens into
a `CalendarConnection` row automatically. This avoids a second OAuth round-trip
for the common case of "my Google account is the family calendar."

Kiosk displays never authenticate as a user. They call one public, read-only
endpoint (`GET /api/displays/bootstrap?code=...`) keyed by the unguessable
`displayCode`. Nothing sensitive (tokens, other households' data) is reachable
through that code.

## 4. Calendar sync

`src/lib/google-calendar.ts` wraps `googleapis`. Key decisions:

- **Tokens are encrypted at rest** (`src/lib/crypto.ts`, AES-256-GCM) and are
  never included in any API response — `CalendarConnection` routes always
  `select` an explicit allowlist of columns that excludes `accessTokenEnc`/
  `refreshTokenEnc`. This satisfies the "don't expose private calendar tokens
  to the browser" requirement structurally, not just by convention.
- **Incremental sync**: Google's `syncToken` is stored per connection and reused
  on subsequent syncs so we only pull deltas, falling back to a full
  `timeMin`/`timeMax` window sync when there's no token yet (first sync, or a
  `410 GONE` token expiry).
- **Cache, don't proxy live**: events are normalized into `CalendarEventCache`
  and every display/dashboard read hits that cache — never Google directly on
  the request path. This keeps the display fast and resilient to Google API
  hiccups, at the cost of eventual consistency bounded by the sync interval
  (5 min dashboard auto-refresh, cron-configurable — see `docs/DEPLOYMENT.md`).
- **Manual event create/edit writes through to Google first**, then caches the
  result, so Google Calendar stays the source of truth and other apps/devices
  see the change too.
- **Provider abstraction**: `CalendarProvider` (`GOOGLE | MICROSOFT | APPLE`) and
  the shape of `CalendarConnection`/`CalendarEventCache` are provider-agnostic.
  Adding Outlook means writing a `lib/microsoft-calendar.ts` with the same
  `fetchEvents/createEvent/updateEvent/deleteEvent` shape and branching sync
  logic on `connection.provider` — no schema change required.

## 5. Rendering model for the display

`/display/[displayCode]` polls `bootstrap` every 60s (picks up layout/theme
changes from the dashboard without a manual reload) and each widget
independently polls its own data at an interval suited to how often it
actually changes (clock: 1s, weather: 15min, calendar: 5min, chores/notes:
1-2min) — see the individual `use*` hooks under `src/lib/hooks/` and the
widgets in `src/components/display/`. This avoids one slow endpoint blocking
the whole screen and keeps payloads small. A future upgrade path (documented,
not built) is Supabase Realtime or a WebSocket channel per household to push
updates instead of polling — the polling intervals were chosen conservatively
so this is a pure optimization, not a correctness fix.

`DisplayGrid` (`src/components/display/DisplayGrid.tsx`) renders a `Layout`'s
`Widget[]` on a CSS Grid using each widget's stored `x/y/w/h` against the
layout's `columns`/`rows` — the same rendering path used by the dashboard's
layout builder preview would use, so what you configure is what the TV shows.

## 6. Security posture

- **Household-level access control**: every mutating/reading API route calls
  `requireHouseholdAccess` (see §2).
- **Tokens**: encrypted at rest, never serialized to the client (§4).
- **Uploads**: `src/lib/storage.ts` re-encodes every uploaded image through
  `sharp` (strips EXIF/GPS, caps dimensions, re-encodes to WebP) before
  writing it anywhere — a crafted "image" can't smuggle arbitrary bytes or
  location metadata onto the display.
- **Notes**: sanitized server-side (HTML tags stripped) before storage, and
  rendered as plain text client-side — defense in depth against stored XSS
  even though the current renderer never uses `dangerouslySetInnerHTML`.
- **Rate limiting**: `src/lib/rate-limit.ts` is applied to the two
  unauthenticated-by-design endpoints (photo upload, display registration).
  It's in-memory (fine for one instance); swap for Upstash/Redis behind the
  same function signature before running multiple serverless regions.
- **Kiosk capability model**: see §3 — the display code is the only credential
  a TV needs, and it can only ever read display-safe data for its own
  household.

## 7. Why this stack

- **Next.js App Router + Route Handlers**: one deployable for admin UI, kiosk
  UI, and API — no separate backend service to operate for an MVP of this
  scope, while Route Handlers give a clean seam to peel off into a standalone
  API (NestJS/Express) later if the household-management/API side outgrows
  the display side.
- **Prisma + PostgreSQL**: relational integrity matters here (a Chore must
  belong to a real FamilyMember in the same Household; a CalendarEventCache
  row must belong to a real CalendarConnection) — this is a strongly
  relational domain, not a document one.
- **Auth.js**: first-class Next.js integration, database sessions, and a
  Google provider that already does the OAuth token dance we need for
  Calendar; swapping to Clerk/Supabase Auth later mainly touches
  `src/lib/auth.ts` and the `getServerSession` call sites.
