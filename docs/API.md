# API Route Reference

All routes live under `src/app/api/`. Unless noted "public," every route calls
`requireHouseholdAccess(householdId)` and requires a signed-in Auth.js session
that belongs to that household. Request/response bodies are validated with
`zod` schemas colocated in each route file.

## Auth

| Route | Methods | Notes |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | Auth.js handler (sign-in, sign-out, callback, session). |

## Household

| Route | Methods | Notes |
|---|---|---|
| `/api/household` | GET | List the caller's households. |
| `/api/household` | POST | Onboarding: create a household, make caller OWNER, seed 5 preset layouts. |
| `/api/household` | PATCH | Update name/timezone. |

## Family members

| Route | Methods | Notes |
|---|---|---|
| `/api/family?householdId=` | GET, POST | List / create. |
| `/api/family/[id]` | PATCH, DELETE | Update; DELETE is a soft-delete (`archivedAt`) to preserve chore/reward history. |

## Calendar

| Route | Methods | Notes |
|---|---|---|
| `/api/calendar/connections?householdId=` | GET | List connections — **never** includes token columns. |
| `/api/calendar/connections` | PATCH, DELETE | Assign a `familyMemberId`/color override, or disconnect. |
| `/api/calendar/events?householdId=&start=&end=&familyMemberId=` | GET | Flattened `AgendaEvent[]` from the cache for the given range, optionally filtered by member. |
| `/api/calendar/events` | POST | Manual event creation — writes to Google first, then caches. |
| `/api/calendar/events/[id]` | PATCH, DELETE | Edit/delete a manually- or sync-created event; writes through to Google. |
| `/api/calendar/sync` | POST | Dashboard "Sync now" — pulls one or all of a household's connections. |
| `/api/cron/sync` | POST | Scheduled sync across **every** household's connections. Requires `Authorization: Bearer $CRON_SECRET`. |

## Chores & Rewards

| Route | Methods | Notes |
|---|---|---|
| `/api/chores?householdId=` | GET, POST | List active chores / create. |
| `/api/chores/[id]` | PATCH, DELETE | `{ complete: true }` records a `ChoreCompletion` and, for recurring chores, rolls `dueDate` forward instead of deactivating. DELETE deactivates (`isActive: false`). |
| `/api/rewards?householdId=&familyMemberId=` | GET, POST | List rewards (optionally with a member's point balance) / create. |
| `/api/rewards/[id]` | POST, DELETE | POST redeems (400 if insufficient points); DELETE deactivates. |

## Meal Plan

| Route | Methods | Notes |
|---|---|---|
| `/api/meals?householdId=&weekStart=` | GET | Fetch-or-create the `MealPlan` for that week (Monday-start). |
| `/api/meals/[planId]/entries` | PUT | Upsert one day/slot entry (breakfast/lunch/dinner). |
| `/api/meals/[planId]/grocery` | POST | Add a grocery item. |
| `/api/meals/[planId]/grocery/[itemId]` | PATCH, DELETE | Toggle checked / remove. |

## Notes

| Route | Methods | Notes |
|---|---|---|
| `/api/notes?householdId=` | GET, POST | List non-expired notes (pinned first) / create. Body is HTML-stripped server-side. |
| `/api/notes/[id]` | PATCH, DELETE | Edit / remove. |

## Photos

| Route | Methods | Notes |
|---|---|---|
| `/api/photos?householdId=` | GET | List enabled photos in slideshow order. |
| `/api/photos` | POST (multipart) | Upload; rate-limited; re-encoded through `sharp` (EXIF stripped, resized, WebP). |
| `/api/photos/[id]` | DELETE | Removes DB row and local file (S3/Supabase drivers just drop the row; add a storage-side delete when wiring those in). |

## Layouts & Widgets

| Route | Methods | Notes |
|---|---|---|
| `/api/layouts?householdId=` | GET, POST | List layouts (presets first) with their widgets / create (optionally cloning another layout's widgets via `cloneFromLayoutId`). |
| `/api/widgets` | POST, PATCH, DELETE | Add / move-resize-toggle-reconfigure / remove a widget on a layout. |

## Displays

| Route | Methods | Notes |
|---|---|---|
| `/api/displays?householdId=` | GET | List a household's paired displays (auth required). |
| `/api/displays` | POST | **Public.** Called by a fresh `/display` page load with no code; mints an unclaimed `Display` row with a long `displayCode` and short `pairingCode`. Rate-limited per IP. |
| `/api/displays/pair` | POST | Admin claims an unclaimed display by its 6-digit `pairingCode`. |
| `/api/displays/[id]` | PATCH, DELETE | Update name/layout/theme/orientation/accent; unpair. |
| `/api/displays/bootstrap?code=` | GET | **Public.** The only endpoint the kiosk itself calls — returns display-safe read data keyed by `displayCode`, or `{ unclaimed: true, pairingCode }` if not yet claimed. |

## Weather

| Route | Methods | Notes |
|---|---|---|
| `/api/weather?householdId=` | GET | Current + 5-day forecast for the household's configured location. |
| `/api/weather` | POST | Geocode a free-text location and save it as the household's weather source. |

## Error shape

Every route funnels errors through `apiErrorResponse()` (`src/lib/session-context.ts`),
returning `{ error: string }` with the appropriate status: `401` (not signed in),
`403` (not a member of the household), `404`, `400` (validation), `429` (rate
limited), or `500`.
