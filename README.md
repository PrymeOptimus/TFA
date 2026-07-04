# Hearth — Family Command Center

A calm, glanceable calendar and household dashboard for a TV, tablet, or wall-mounted
touchscreen — inspired by the "smart family display" category (e.g. Mango Display),
built from scratch with original branding, UI, and code.

## What's here

This repo is a Phase 1 + Phase 2 **working MVP**, plus scaffolding for Phase 3:

| Area | Status |
|---|---|
| Auth (Google OAuth via Auth.js) | ✅ working |
| Household setup / onboarding | ✅ working |
| Family members (color, avatar, initials) | ✅ working |
| Google Calendar sync (OAuth, incremental sync, manual event create/edit) | ✅ working |
| Full-screen display page, month/week/agenda/list views | ✅ working |
| Clock, date, greeting | ✅ working |
| Weather (OpenWeatherMap, 5-day forecast) | ✅ working |
| Chores + points, touch check-off | ✅ working |
| Reward bank + redemption | ✅ working |
| Weekly meal planner + grocery list | ✅ working |
| Sticky notes / announcements | ✅ working |
| Photo upload + crossfade background | ✅ working (local disk; Supabase/S3 stubbed) |
| Layout presets + widget grid builder | ✅ working (numeric x/y/w/h; drag canvas is a follow-up) |
| Multi-screen pairing (pairing code → claim flow) | ✅ working |
| Microsoft Outlook / Apple iCal | 🧱 scaffolded in schema (`CalendarProvider` enum), not implemented |
| Google Photos sync | 🧱 scaffolded (`Photo.source`), not implemented |
| True drag-and-drop layout canvas | 🧱 documented upgrade path, numeric builder ships instead |

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, data flow, security model
- [`docs/API.md`](docs/API.md) — full API route reference
- [`docs/COMPONENTS.md`](docs/COMPONENTS.md) — React component tree
- [`docs/WIREFRAMES.md`](docs/WIREFRAMES.md) — layout presets and screen descriptions
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — phase-by-phase build plan
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deploying to Vercel + Supabase/Neon
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — environment variables
- [`docs/TESTING_CHECKLIST.md`](docs/TESTING_CHECKLIST.md) — manual + automated test checklist
- [`prisma/schema.prisma`](prisma/schema.prisma) — full data model

## Quick start (local dev)

```bash
cp .env.example .env
# fill in DATABASE_URL, GOOGLE_CLIENT_ID/SECRET, TOKEN_ENCRYPTION_KEY, OPENWEATHER_API_KEY

npm install
npm run prisma:migrate   # creates tables
npm run dev              # http://localhost:3000
```

1. Visit `/login`, sign in with Google (this also connects your primary Google Calendar).
2. You'll land on `/dashboard` and be asked to create a household.
3. Add family members at `/dashboard/family`, chores at `/dashboard/chores`, etc.
4. Open `/display` in a new tab (or on the TV/tablet) — it mints a pairing code.
5. Enter that code at `/dashboard/displays` to claim the screen and assign it a layout.

## Tech stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Prisma · PostgreSQL ·
Auth.js (NextAuth) · Google Calendar API · OpenWeatherMap · Sharp (image processing)

See `docs/ARCHITECTURE.md` for the full rationale behind each choice.
