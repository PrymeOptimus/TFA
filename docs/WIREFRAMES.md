# Wireframe Descriptions

Hearth's visual language: soft rounded cards (`rounded-xl2` = 20px), subtle
shadows (`shadow-card`), a single configurable accent color per household/display
(`--hearth-accent`), and a dark-first palette tuned for TVs (`globals.css`
defines both `:root` light values and a `.dark` override). Typography scales
with `clamp()` so the same layout reads at arm's length on a 10" tablet and
across a kitchen on a 55" TV.

## Layout presets (seeded per household in `/api/household` POST)

### 1. Full Calendar
Single dominant `CALENDAR_MONTH` (or `CALENDAR_WEEK`) widget spanning nearly the
whole grid, with a slim `CLOCK` strip in a corner. For households that mostly
want "what's on this month," e.g. mounted in a hallway.

```
┌─────────────────────────────┬────────┐
│                             │ Clock  │
│      Calendar (Month)       ├────────┤
│                             │Weather │
│                             │        │
└─────────────────────────────┴────────┘
```

### 2. Family Dashboard (the default first layout)
Balanced grid: clock + weather across the top, a week calendar as the visual
anchor, chores and notes as side cards, meal plan as a footer strip. This is
what `prisma/seed.ts` wires up and what a new household lands on.

```
┌──────────┬──────────┬─────────────┐
│  Clock   │ Weather  │   Chores    │
├──────────┴──────────┤             │
│                      │             │
│   Calendar (Week)    ├─────────────┤
│                      │   Notes     │
├──────────────────────┴─────────────┤
│           Meal Plan (today)         │
└─────────────────────────────────────┘
```

### 3. Kitchen Command Center
Chores and meal plan promoted to equal size with the calendar — optimized for
the room where morning routines and grocery decisions actually happen.

```
┌────────┬────────┬──────────────────┐
│ Clock  │Weather │                  │
├────────┴────────┤   Calendar (Day  │
│    Chores       │      Agenda)     │
├─────────────────┤                  │
│   Meal Plan      │                  │
└──────────────────┴──────────────────┘
```

### 4. Minimal Clock + Agenda
Just two widgets, large: a big clock and a Today/Tomorrow/Upcoming list. For a
small tablet or a second screen that doesn't need everything.

```
┌───────────────────┐
│                    │
│    12:45 PM        │
│  Tuesday, July 7    │
├───────────────────┤
│  Today             │
│  Tomorrow          │
│  Upcoming          │
└───────────────────┘
```

### 5. Photo Frame + Calendar Overlay
`background: "photos"` — `PhotoBackground` renders full-bleed behind
everything with a dark overlay (`overlayOpacity`, default 0.55) for text
contrast; only a slim agenda/clock strip sits on top, so the photo stays the
star.

```
┌═════════════════════════════════════┐
║   (crossfading full-bleed photo)     ║
║                                       ║
║  ┌───────────┐                       ║
║  │ Clock      │                       ║
║  │ Agenda list │                      ║
║  └───────────┘                       ║
╚═══════════════════════════════════════╝
```

## Screen-by-screen

- **`/login`** — centered card, single "Continue with Google" button, one
  sentence explaining why Google (sign-in *and* calendar sync).
- **`/dashboard` (Overview)** — three-card row: Agenda, Chores, Notes — the
  "what do I need to know right now" view for a parent checking the app on
  their phone.
- **`/dashboard/family`** — add-member form (name, color swatches, child
  toggle) above a responsive card grid of existing members with avatar,
  name, and a remove action.
- **`/dashboard/calendar`** — one card per `CalendarConnection` showing
  status pill (Connected/Error/Needs reauth), family-member assignment
  dropdown, color-override swatches, last-synced timestamp, and a global
  "Sync now" button.
- **`/dashboard/chores`** — inline chore-creation form (title, assignee,
  points, recurrence), a list of active chores with a "Mark done" button,
  and a reward-bank section below with its own creation form.
- **`/dashboard/meals`** — a 7-column × 3-row (breakfast/lunch/dinner) grid
  of inline-editable text fields, plus a grocery checklist card.
- **`/dashboard/notes`** — a compose card (textarea, color swatches, pin
  toggle) above a masonry-style grid of sticky notes.
- **`/dashboard/photos`** — a file-input upload card above a thumbnail grid
  with hover-to-delete.
- **`/dashboard/widgets`** — layout selector pills, then the active layout's
  widget list with numeric x/y/w/h fields, an enabled toggle, and an
  "add widget" control. (Numeric grid controls today; see
  `docs/IMPLEMENTATION_PLAN.md` Phase 3 for the pointer-drag upgrade.)
- **`/dashboard/displays`** — a "pair a display" form (6-digit code + name)
  above a card per paired display with layout/orientation/theme selects.
- **`/settings`** — account (email + sign out), household (name/timezone),
  and weather location forms as stacked cards.
- **`/display/[displayCode]`** — no chrome, no scrollbars (`.kiosk` class
  disables overscroll/bounce), CSS Grid filling the viewport per the active
  layout; unclaimed displays instead show a single giant pairing code on a
  black background.

## Accessibility & touch

- Minimum interactive target on kiosk surfaces is 56×56px (`Button` size="touch").
- Color is never the only signal: family-member badges always pair a color
  swatch with initials/name text.
- Dark mode meets WCAG AA contrast for body text against `--hearth-bg`/`--hearth-card`.
