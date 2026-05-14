# Live Watch upgrades + Clip History Timeline

Three additions to the dashboard (`src/routes/_app.index.tsx`), all powered by data we already collect.

## 1. Multi-stream Live Watch (see all live at once)

Today Live Watch shows ONE iframe at a time via a dropdown. Switch to a grid:

- Render an iframe tile for **every source where `last_known_live = true`** (or `force_live_until > now`).
- Layout: `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`, each tile `aspect-video`.
- Each tile gets its own header strip with: name, LIVE dot, viewer count, the existing UNMUTE toggle (per-tile state — only one unmuted at a time, clicking unmute on tile B mutes tile A so audio doesn't pile up).
- Each tile keeps its own GRAB CLIP button + caption input directly underneath (compact form), so we can clip from any stream without switching focus.
- Offline sources collapse into a small "OFFLINE (3): ab, rampage, ..." footer row with a "force live" link kept for later.
- Old single-stream dropdown removed.

## 2. Live chat-spike activity overlay + spike tracker

We already poll chat with `runChatPulse` every minute and write `chat_velocity` rows (msgs/sec, baseline, spike_ratio, is_spike, sample_messages). Surface that:

**Per-tile spike meter (overlay on each Live Watch iframe):**
- Bottom-left badge showing current `msgs_per_sec` and a thin horizontal bar colored by `spike_ratio`:
  - grey (<1.2x), gold (1.2–2x), blood-red pulsing (≥2x = spike)
- Updates every 15s by querying the latest `chat_velocity` row per source.

**New "SPIKE TRACKER" panel** under Live Watch:
- Horizontal sparkline strip per live source showing the last ~30 minutes of `msgs_per_sec` (one row per source), with red dots where `is_spike = true`.
- Hovering a red dot shows: timestamp, ratio, top sample message, and — if a clip was created from that spike (`matched_velocity_id`) — a link to it.
- "TRACK ALL" toggle: when on, refreshes every 10s; off = static.

New server fn `listLiveChatActivity` in `src/lib/clips.functions.ts`:
- Returns, per live source: latest velocity row + last 30 min of `(created_at, msgs_per_sec, is_spike, spike_ratio, clip_id)` rows.
- Powers both the per-tile badge and the Spike Tracker sparklines.

## 3. Clip History Timeline

New panel "RECENT GRABS" between the status bar and Live Watch:

- Horizontal scrolling timeline (newest left), one chip per clip from the last 24h.
- Each chip: thumbnail (or placeholder), `HH:MM:SS` timestamp, source name, hook caption truncated to 40 chars, and a tiny status dot (processing / approved / rejected).
- Click → opens the clip in the existing queue card (scroll-to + focus).
- Auto-refreshes every 30s.

New server fn `listRecentClips` (last 24h, all statuses, limit 40) in `src/lib/clips.functions.ts`. Reuses existing `clips` columns — no schema changes.

## Files touched

- `src/lib/clips.functions.ts` — add `listLiveChatActivity` + `listRecentClips`.
- `src/routes/_app.index.tsx` — replace `LiveWatchPanel` with multi-stream grid; add `SpikeTrackerPanel` and `RecentGrabsTimeline` components in the same file (or split into `src/components/live-watch-grid.tsx`, `spike-tracker.tsx`, `recent-grabs-timeline.tsx` for readability — recommend splitting).

## Out of scope

- No DB migrations (all data already collected).
- No changes to chat-pulse cadence (still every minute via cron).
- Not auto-pausing/muting tiles when many streams are live — single-unmute rule is enough.

## Open question

Streaming 5+ Kick iframes simultaneously is heavy on CPU/bandwidth. Two options:
- **A.** Render all live iframes (best situational awareness, may chug on iPhone).
- **B.** Render thumbnails/poster images for all live sources, only mount the iframe when you click "WATCH" on a tile (lighter).

Default: **A** on desktop, auto-fallback to **B** on `<sm` viewport. Say the word if you want B everywhere.