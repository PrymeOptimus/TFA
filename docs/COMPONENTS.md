# React Component Tree

```
src/app/
├─ layout.tsx                      Root layout — <Providers> (NextAuth SessionProvider)
├─ page.tsx                        Landing page (redirects to /dashboard if signed in)
├─ login/page.tsx                  Google sign-in button
│
├─ dashboard/
│  ├─ layout.tsx                   Resolves session + household membership (server);
│  │                               renders OnboardingForm if no household, else
│  │                               <HouseholdProvider><DashboardShell>{children}</></>
│  ├─ HouseholdContext.tsx          React context: { householdId, householdName, timezone, role }
│  ├─ DashboardShell.tsx            Sidebar nav + sign-out (client)
│  ├─ OnboardingForm.tsx            "Create your household" form (client)
│  ├─ page.tsx                      Overview: Agenda / Chores / Notes cards
│  ├─ calendar/page.tsx             Connection list, family-member/color assignment, "Sync now"
│  ├─ family/page.tsx               Family member CRUD + color/avatar picker
│  ├─ chores/page.tsx               Chore CRUD + reward bank CRUD
│  ├─ meals/page.tsx                Weekly meal grid + grocery list
│  ├─ notes/page.tsx                Sticky note CRUD
│  ├─ photos/page.tsx               Upload + gallery grid
│  ├─ widgets/page.tsx              Layout picker + widget add/position/enable grid builder
│  └─ displays/page.tsx             Pairing form + per-display settings (layout/theme/orientation)
│
├─ settings/
│  ├─ page.tsx                      Server: loads household + weather settings
│  └─ SettingsForm.tsx               Account / household / weather forms (client)
│
├─ display/
│  ├─ page.tsx                      Mints a new Display row + pairing code, redirects (server, force-dynamic)
│  └─ [displayCode]/page.tsx         Kiosk view: bootstrap poll → pairing screen OR <PhotoBackground> + <DisplayGrid>
│
└─ api/                             Route Handlers — see docs/API.md

src/components/
├─ ui/                              Presentational, no data fetching
│  ├─ Card.tsx                      Card / CardHeader / CardTitle
│  ├─ Button.tsx                    variant × size (incl. `touch` — 56px min target for kiosks)
│  ├─ Badge.tsx                     Colored pill, auto-contrast text
│  ├─ Input.tsx
│  └─ Toggle.tsx                    Switch control
│
└─ display/                         Data-fetching widgets, used by both /display and /dashboard cards
   ├─ FamilyMemberAvatar.tsx         Avatar image or color+initials fallback
   ├─ ClockWidget.tsx                Live clock/date/greeting (1s tick)
   ├─ WeatherWidget.tsx              Current + 5-day forecast (15min poll)
   ├─ CalendarMonthView.tsx          Month grid with event chips
   ├─ CalendarWeekView.tsx           7-day columns with stacked event chips
   ├─ CalendarDayAgenda.tsx          Single-day agenda list
   ├─ CalendarListView.tsx           Today / Tomorrow / Upcoming sections
   ├─ ChoresWidget.tsx               Touch-checkable chore list (5min poll)
   ├─ MealPlanWidget.tsx             Today's breakfast/lunch/dinner (10min poll)
   ├─ NotesWidget.tsx                Sticky-note grid (2min poll)
   ├─ PhotoBackground.tsx            Full-bleed crossfading background + readability overlay
   └─ DisplayGrid.tsx                Renders a Layout's Widget[] on CSS Grid, dispatching by WidgetType

src/lib/
├─ prisma.ts                        Singleton PrismaClient
├─ auth.ts                          NextAuth config (Google provider, Prisma adapter, token capture)
├─ crypto.ts                        AES-256-GCM encrypt/decrypt for OAuth tokens
├─ google-calendar.ts               googleapis wrapper: fetchEvents/createEvent/updateEvent/deleteEvent
├─ weather.ts                       OpenWeatherMap client + geocoding
├─ storage.ts                       Photo upload: sharp sanitize/resize → local disk (S3/Supabase stubbed)
├─ rate-limit.ts                    In-memory sliding-window limiter
├─ session-context.ts               requireHouseholdAccess(), apiErrorResponse()
├─ colors.ts                        Accent palette, initials, contrast-text helper
├─ clsx.ts                          Minimal classname joiner
└─ hooks/
   ├─ useInterval.ts                 Poll-on-interval hook
   └─ useAgendaEvents.ts             Fetches + auto-refreshes AgendaEvent[] for a date range
```

## Data flow for a display widget

```
DisplayGrid (per-widget switch)
  └─ e.g. CalendarWeekView
       └─ useAgendaEvents(householdId, start, end, familyMemberIds)
            └─ useInterval(fetch /api/calendar/events?..., 5min)
                 └─ GET /api/calendar/events
                      └─ prisma.calendarEventCache.findMany(...)
                           └─ (populated by /api/calendar/sync or /api/cron/sync)
```
