# Testing Checklist

## Automated

- [ ] `npm run typecheck` — passes with zero errors (verified as of this
      writing).
- [ ] `npm run build` — production build succeeds (verified as of this
      writing, with a placeholder `DATABASE_URL`; re-verify against a real
      database before deploying).
- [ ] `npm run lint` — run and fix findings before merging.
- [ ] `npm run test` — Vitest is wired up (`vitest.config` not yet added);
      priority unit-test targets, in order of risk:
  - [ ] `src/lib/crypto.ts` — encrypt→decrypt round-trips to the original
        plaintext; decrypting a tampered payload throws.
  - [ ] `src/lib/rate-limit.ts` — allows up to the limit, rejects the next
        request, resets after the window.
  - [ ] `src/app/api/chores/[id]/route.ts`'s `nextDueDate()` — DAILY/WEEKLY/
        MONTHLY all advance correctly across month/year boundaries.
  - [ ] `src/lib/colors.ts`'s `readableTextColor()` — known light/dark hex
        inputs return the expected contrast color.

## Manual — Auth & onboarding

- [ ] Fresh sign-in via Google lands on the onboarding form (no household yet).
- [ ] Creating a household seeds exactly 5 preset layouts.
- [ ] Signing out and back in returns to `/dashboard` directly (no re-onboarding).
- [ ] A second Google account, signing in for the first time, gets its own
      household (households are per-user until explicitly shared/invited —
      household invites are not yet implemented).

## Manual — Calendar

- [ ] After first sign-in, `/dashboard/calendar` shows one `CONNECTED`
      connection with your Google email.
- [ ] "Sync now" pulls real events from your primary Google Calendar into
      the cache (spot-check against Google Calendar directly).
- [ ] A recurring Google event appears correctly on the month/week views
      (each occurrence, not just the first).
- [ ] Assigning a family member to a connection color-codes that
      connection's events on the display.
- [ ] Creating an event from a future "manual event" UI (or directly via
      `POST /api/calendar/events`) shows up in actual Google Calendar.
- [ ] Revoking Calendar access from Google's account settings, then syncing,
      flips the connection to `ERROR`/`NEEDS_REAUTH` with a visible message
      rather than crashing the sync route.

## Manual — Family, chores, rewards

- [ ] Adding/removing family members updates color-coding across calendar,
      chores, and meal widgets.
- [ ] A one-time chore disappears from `ChoresWidget` after being marked done
      and awards the right number of points.
- [ ] A recurring chore's `dueDate` rolls forward instead of disappearing
      after completion.
- [ ] A reward redemption is rejected (400) when the family member doesn't
      have enough points, and succeeds when they do.

## Manual — Meals, notes, photos

- [ ] Editing a meal-plan cell persists after a page reload.
- [ ] Grocery items can be added, checked, and removed.
- [ ] A pinned note sorts above unpinned notes; an expired note (past
      `expiresAt`) stops appearing.
- [ ] Uploading a non-image file is rejected with a clear error.
- [ ] Uploading a photo with EXIF GPS data does **not** leak that data (the
      re-encoded WebP output has been stripped — verify with `exiftool` on
      the stored file).
- [ ] Photo slideshow crossfades and the overlay keeps foreground widget
      text readable against a bright photo.

## Manual — Layouts, widgets, displays

- [ ] Selecting each of the 5 preset layouts on a display changes its
      appearance without a manual refresh (within the 60s bootstrap poll).
- [ ] Adding/removing/resizing/disabling a widget in `/dashboard/widgets`
      is reflected on the paired display.
- [ ] Visiting `/display` with no code mints a **new** pairing code every
      time (never reuses one).
- [ ] Entering an already-claimed or invalid pairing code shows an error,
      not a silent no-op.
- [ ] Unpairing a display from `/dashboard/displays` makes its old
      `displayCode` show "Unknown display code" (not stale data).
- [ ] The display page never shows a scrollbar or bounce/rubber-banding on
      touch, at both a 10" tablet resolution and a 4K TV resolution.

## Manual — Responsiveness & accessibility

- [ ] Dashboard is usable at a phone viewport width (375px) — no horizontal
      scroll, forms remain operable.
- [ ] Display page renders correctly in both landscape and portrait
      (`orientation` setting on `Display`).
- [ ] Dark and light themes both meet reasonable contrast for body text.
- [ ] All touch controls on the display (chore checkoff, etc.) are at least
      44×44px.

## Security spot-checks

- [ ] `GET /api/calendar/connections` response never contains
      `accessTokenEnc`/`refreshTokenEnc` (check the raw network response,
      not just the UI).
- [ ] A signed-in user from Household A gets 403 when calling any
      `householdId`-scoped route with Household B's id.
- [ ] `/api/displays/bootstrap?code=<guess>` for a nonexistent code returns
      404, not a stack trace or another household's data.
- [ ] Rapid-fire requests to `POST /api/photos` or `POST /api/displays`
      eventually return 429.
