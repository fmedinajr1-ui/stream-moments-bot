# Live sound + new source + mobile dashboard

## 1. Fix audio on the live player

Browsers block autoplay-with-sound, so Kick's iframe starts muted and there's no built-in unmute control reachable from outside (cross-origin iframe).

- Start the iframe muted (required for autoplay to work at all).
- Add an **"UNMUTE"** overlay button on top of the player. On click, swap the iframe `src` from `?muted=true&autoplay=true` to `?muted=false&autoplay=true` (forces a reload with sound, which now counts as user-gesture-initiated).
- Add `allow="autoplay; fullscreen; encrypted-media"` so audio + DRM segments play.
- Show a small "TAP TO UNMUTE" hint over the player while muted.

## 2. Add Adrien Broner as a tracked source

- Insert a new row in `sources`: `slug = adrienbroner`, `display_name = ADRIEN BRONER`, `is_monitoring = true`.
- Leave the existing `ab` / `AB` row alone (you can rename or delete later — say the word).
- Rampage (`rampagejackson`) is already tracked and currently live, so he'll show in the dropdown automatically when live.

The Live Watch dropdown already lists everyone in `sources` ordered by `last_known_live DESC`, so Broner appears the moment the next poll marks him live (and is still selectable when offline).

## 3. Make the whole dashboard mobile-friendly (iPhone)

Today the index page assumes desktop width. Fixes, all CSS/layout only:

- **Header bar** (`_app.index.tsx` top strip): wrap the LIVE / NEW CLIPS / PAUSE row so it stacks 2-up on `<sm`, PAUSE button becomes full-width.
- **LiveWatchPanel**:
  - Header row: stack title + dropdown vertically on mobile, dropdown becomes full-width.
  - Body grid `grid-cols-1 lg:grid-cols-[2fr_1fr]` already stacks; tighten padding to `p-3` on mobile.
  - Caption input + duration buttons: bigger touch targets (`py-3`, `text-sm`).
  - GRAB CLIP button: full-width, sticky-ish at bottom of the panel on mobile.
- **Filter bar** (STREAMER / MIN SCORE): already uses `flex-wrap` but the score grid + slider crowd at 375px — switch the streamer select to `w-full sm:w-auto` and reduce horizontal padding.
- **Clip grid**: already `grid-cols-1 lg:grid-cols-2` — fine. Verify `ClipCard` internals don't overflow (action buttons row may need `flex-wrap`).
- Add `viewport-fit=cover` meta if not present, and bump base touch targets in the action buttons to min 44×44 px (iOS guideline).
- Hide the desktop-only "PRESS SPACE" hint on mobile (already gated by `hidden md:block`, keep).
- Set the editor preview to mobile so you can iterate visually.

## Files touched

- `src/routes/_app.index.tsx` — unmute toggle + mobile-responsive classes throughout, including `LiveWatchPanel` and the header/filter rows.
- `src/components/ClipCard.tsx` (only if action row overflows on 375px width — read first, edit only if needed).
- DB migration: `INSERT INTO sources (slug, display_name) VALUES ('adrienbroner', 'ADRIEN BRONER');`

## Out of scope (say the word and I'll do it)

- Removing/renaming the existing `ab` source row.
- A custom HLS player (would let us mute/unmute without reloading the iframe, but requires server-side HLS proxying — bigger lift).
