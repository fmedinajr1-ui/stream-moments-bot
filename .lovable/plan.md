## Goal

Make chat spikes automatically create marked moments — no OBS, no local setup. The existing resolver then turns them into clips from the Kick VOD after the stream ends.

## How it works today vs after

**Today** when a chat spike is detected:
- Records the spike in the database
- Tries to ping the OBS watcher (does nothing if you're not running it)
- Only creates a clip if you explicitly turn on server-side HLS capture

**After this change**: every spike automatically inserts a row in `marked_moments` (same as if you'd clicked "Mark Moment"). The resolver cron that already exists then pulls the clip from the VOD when it's available — usually within a few minutes after the stream ends.

## What you'll see

- Watch a stream → chat goes wild → a "Marked Moment" appears in your dashboard automatically
- After the stream ends, the resolver finds it in the VOD and renders a clip
- Clip shows up in your Library tagged `auto_grabbed: true` with the spike caption

## Guardrails (so it doesn't spam)

- Reuses your existing **per-source cooldown** (`auto_grab_cooldown_sec`, default 180s) — won't auto-mark the same channel twice within the cooldown window
- Reuses your existing **spike sensitivity** per source and **min msgs/sec** in agent settings
- Respects the global pause toggle (`is_paused`)
- Adds a new toggle **"Auto-mark moments from chat spikes"** in Settings so you can turn it off independently of HLS auto-grab

## Technical details

In `src/lib/chat-pulse.server.ts`, when `isSpike && velRow` is true:
1. Read new flag `auto_mark_on_spike` from `agent_settings` (defaults to `true`)
2. Check cooldown by querying `marked_moments` for a recent row from the same source
3. If clear, insert a row into `marked_moments` with:
   - `source_id`, `marked_at = now()`, `duration_sec = 30`
   - `caption` built from the loudest sample message (e.g. "Chat spike: 4.2x baseline")
   - `status = 'pending'`
4. Write an `audit_log` row (`action: spike_auto_marked`)
5. The existing `/api/public/cron/resolve-moments` cron already picks it up — no changes needed there

Migration adds:
- `agent_settings.auto_mark_on_spike boolean default true`

Settings UI in `src/routes/_app.settings.tsx` gets a new toggle for the flag.

The OBS nudge stays in place (no-op if watcher isn't running, helpful if it ever is).

## Files touched

- `supabase/migrations/...` — add `auto_mark_on_spike` column
- `src/lib/chat-pulse.server.ts` — insert marked_moment on spike with cooldown
- `src/routes/_app.settings.tsx` — add toggle
- `src/lib/agent.functions.ts` — expose new flag in get/update settings
