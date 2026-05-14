# Auto-grab on chat spikes (and make the spike tracker actually fire)

## What's working vs. not

**Working:** chat-pulse cron fires every 30s, hits all 3 live sources (rampagejackson, adrienbroner, deenthegreat), writes a `chat_velocity` row per source, and the auto-grab call (`createSpikeClip`) is already wired in `chat-pulse.server.ts` to fire when `is_spike = true`.

**Broken:** every `chat_velocity` row has `msgs_per_sec = 0`. The Kick WebSocket sampler (`src/lib/kick-ws.server.ts`) connects but never receives chat frames — so spike_ratio is 0, `is_spike` is never true, and no auto-grab ever triggers. That's why the Spike Tracker shows `0.0/s` and `0 SPIKES` for every streamer.

Worker logs show the cron requests returning 200 but **none** of the `[kick-ws] upgrade…` / `[kick-ws] connected…` / `[kick-ws] first msg…` console lines appear. That means the upgrade is short-circuiting silently or the WS closes before Pusher's `connection_established` arrives.

## Fix plan

### 1. Repair the Kick chat sampler

Add diagnostic logging and a working transport. Likely root cause: Pusher's app key / cluster string we're using (`ws-us2.pusher.com/app/eb1d5f283081a78b932c`) is stale or Cloudflare's outbound WS upgrade isn't completing the Pusher handshake before we send `subscribe`.

Steps:
- Re-fetch the current Pusher app key + cluster from `https://kick.com/api/v2/channels/<slug>` (the Kick page bootstrap exposes them as `chatroom.channel_id`, plus a `pusher` config the modern frontend uses). Cache per-slug for 1h.
- After upgrade, **wait** for `pusher:connection_established` before subscribing (already done) but also tolerate the case where the upgrade returns 200 instead of 101 by falling back to a polled REST endpoint (`/api/v2/channels/<slug>/messages?cursor=...`) for chat counts. The REST fallback gives us a real `msgs_per_sec` even when WS is blocked from Workers.
- Persist the sampler outcome to `audit_log` (`action='chat_pulse_sample'`, details with `connected`, `msg_count`, `error`) so we can see in the UI whether each tick worked.

### 2. Make thresholds configurable

Today the threshold lives in `chat_pulse.server.ts` as `is_spike = ratio >= sensitivity AND mps >= 0.5` where `sensitivity` comes from `sources.spike_sensitivity` (default 2.0). Add three more knobs to `agent_settings`:

- `spike_window_sec` (default 60) — look-back window for "spike within last N seconds". Computed as `recent_msgs / window_sec` and compared to baseline.
- `spike_min_mps` (default 0.5) — floor so quiet streams don't trigger on noise.
- `auto_grab_cooldown_sec` (default 180) — minimum seconds between auto-grabs **per source**. Without this a hot stream creates a clip every 30s.

Migration adds the columns. Settings page (`_app.settings.tsx`) gets number inputs for these.

### 3. Per-source cooldown + audit trail

Before calling `createSpikeClip`, query `clips.created_at` for the latest auto-grabbed clip on this source (we can detect auto vs manual by `score_rationale LIKE 'Live spike-triggered%'` or add an `auto_grabbed` boolean column — recommend the column for clarity). If `now - last_auto < cooldown`, skip and log `audit_log` row `action='spike_grab_skipped_cooldown'`.

When a grab does fire: `audit_log` row `action='spike_grab_triggered'` with the spike ratio, msgs/sec, and the resulting clip_id.

### 4. Surface it in the UI

In `src/components/spike-tracker.tsx`:
- Add an "ARMED" badge per source showing the current threshold (e.g. "ARMED · 2.0x · ≥0.5/s · 180s cooldown") pulled from `agent_settings` + `sources.spike_sensitivity`.
- Add a "LAST AUTO-GRAB" row per source ("12s ago — clip in queue", or "—" if none).
- The chat-pulse activity row already shows ratio coloring (gold ≥1.2x, blood ≥2x); add a small flame icon when an auto-grab fired in the last 5 min.

In `src/components/live-watch-grid.tsx`, the per-tile chat badge already exists — add a "🔥 AUTO" tag that flashes when `auto_grabbed` clip appears for this source.

### 5. Manual verification path

Add a "TEST AUTO-GRAB" button in Settings that:
- Picks one live source.
- Inserts a synthetic `chat_velocity` row with `is_spike=true, spike_ratio=3.0, msgs_per_sec=2.0`.
- Calls `createSpikeClip` directly.
- Returns the new clip id so you can watch it appear in the timeline + render.

Lets us prove the auto-grab pipeline end-to-end without waiting for a real spike.

## Files touched

- `src/lib/kick-ws.server.ts` — refresh Pusher config per slug, add REST fallback.
- `src/lib/chat-pulse.server.ts` — read new threshold settings, enforce cooldown, write audit rows.
- `src/lib/clips.functions.ts` — add `getSpikeSettings`, `updateSpikeSettings`, `testAutoGrab` server fns; extend `listLiveChatActivity` to return last auto-grab per source.
- `src/components/spike-tracker.tsx` — ARMED badge, last-auto-grab row, flame indicator.
- `src/components/live-watch-grid.tsx` — auto-grab flash on tile.
- `src/routes/_app.settings.tsx` — threshold inputs + TEST button.
- DB migration: add `agent_settings.spike_window_sec`, `spike_min_mps`, `auto_grab_cooldown_sec`; add `clips.auto_grabbed boolean default false`.

## Out of scope

- Per-source threshold overrides beyond `spike_sensitivity` (already exists). Global is enough for now.
- Smarter "context-aware" spike (e.g. reading sample messages with AI to decide if it's a real moment). The user already mentioned wanting AI training elsewhere — leave for later.
- Replacing the WS sampler with a long-running connection (Workers don't support that cleanly — would need a Durable Object).

## Open question

If the WS sampler can't be fixed from Cloudflare Workers and the REST fallback is too coarse (Kick doesn't expose a chat-history REST endpoint without auth), the alternative is **viewer-count spikes** instead of chat-velocity spikes — `kick.com/api/v2/channels/<slug>` returns live viewer count, easy to baseline and detect surges. Less precise but reliable. Want me to add that as a parallel signal so auto-grab works regardless of chat?