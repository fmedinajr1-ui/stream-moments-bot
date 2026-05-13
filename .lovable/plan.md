# Always-on auto-clipper — no manual buttons

## What you're asking for

> "Check live pages all day from the handles and constantly watch for clip-worthy moments."

That's exactly what the cron jobs are supposed to do. The problem is the system was leaning on the manual **RUN BATCH NOW** button (which is what timed out with "Load failed"). The cron itself is fine — it just needs to be made bulletproof so you never have to touch a button.

## Honest reality check (so expectations match)

This stack runs on serverless workers (30s max per run). It cannot literally "watch the video stream." What it CAN do, fully automatically, every minute, all day:

1. **Every 30s** — pull last 30s of chat from each live handle, compute msgs/sec, detect spikes vs baseline → save to `chat_velocity`
2. **Every 60s** — for each handle: check live status, fetch any new Kick auto-clips, match each clip's timestamp to nearby chat spikes, AI-score it with your past approve/reject history as taste examples, drop scoring ≥ threshold into your Queue as `pending`

So "watching all day" = polling chat every 30s + checking for new clips every 60s + AI-scoring them with your taste. The clips themselves come from Kick's own auto-clip system (Kick generates them when something pops off — viewers clipping, hype moments, etc.).

If you want literal video watching (audio energy, face detection, OCR on stream) we need an always-on box outside Lovable. Not happening in this project.

## What I'll change

### 1. Make the polling cron actually reliable (the real fix for "Load failed")
In `src/lib/poll-kick.server.ts`:
- **Parallelize per-source**: process all sources concurrently with `Promise.allSettled` (one slow streamer can't block others)
- **Parallelize per-clip**: score clips for a single source in parallel, capped at 5 concurrent
- **Per-AI-call timeout**: wrap each Gemini call in `AbortSignal.timeout(10_000)` → falls back to heuristic score if slow
- **Cap clips per cycle**: max 5 new clips scored per source per minute (Kick rarely produces more than 1-2 anyway)
- **Skip offline sources**: if `getChannel()` returns `isLive: false`, skip clip fetch entirely
- **Don't crash the run on a single error**: every per-source/per-clip step wrapped in try/catch with logged result

This turns a fragile 60-120s sequential run into a resilient ~5s parallel run. Crons stop silently failing.

### 2. Verify crons are actually scheduled and running
- Check `cron.job` to confirm `chat-pulse` (every 30s) and `poll-kick` (every 60s) are active
- If missing, re-register them with `pg_cron` pointing at the stable URL `project--{id}.lovable.app/api/public/cron/poll-kick` and `/api/public/cron/chat-pulse`
- Add a `cron.job_run_details` query into the Analytics page so you can SEE the cron running (last 20 runs, success/fail, duration)

### 3. Remove the manual buttons that confused you
In `src/routes/_app.index.tsx` (and wherever else):
- **Delete** "RUN BATCH NOW" button (caused the load-failed)
- **Delete** "BATCH MODE" toggle (it was just bulk-approve UI for the queue)
- Replace with a small **"AUTO-MONITORING · ON"** status indicator showing:
  - Last cron tick time (e.g. "polled 23s ago")
  - # of live sources right now
  - # of clips scored in last hour
  - Single **PAUSE AGENT** toggle (writes to existing `agent_settings.is_paused`)

That's it. No buttons to press. You just open the Queue and approve/reject what the agent surfaces.

### 4. Keep bulk-approve in the Queue (it's useful)
The multi-select checkboxes on the Queue page stay — they're for *your* workflow when 10 clips are waiting. Just no longer called "BATCH MODE" — labeled **SELECT MULTIPLE** with a checkbox column.

## Files touched

**Edited:**
- `src/lib/poll-kick.server.ts` — parallelize, timeouts, resilient error handling
- `src/routes/_app.index.tsx` — remove manual run button, add live cron status panel
- `src/components/clip-card.tsx` / queue page — rename "BATCH MODE" → "SELECT MULTIPLE"
- `src/routes/_app.analytics.tsx` — add "Cron Health" panel showing last 20 runs

**No new files. No DB schema changes.** Only data change: re-register the two cron jobs if they aren't currently active (one-shot SQL via `cron.schedule`).

## How you'll verify it's working after the change

1. Add a Kick handle on **Sources** → wait 60s
2. Open **Home** → see "Last poll: 14s ago · 1 live source · 0 clips scored (no new auto-clips on Kick yet)"
3. Open **Analytics → Cron Health** → see green ticks every 30s/60s
4. When the streamer pops off and Kick auto-generates a clip → within ~60s it appears in the Queue with score + spike badge + AI rationale
5. You never click anything except APPROVE / REJECT on cards

## What this does NOT solve (be clear)

- Won't generate clips Kick itself didn't generate. If a streamer has clips disabled, we have nothing to pull.
- Won't watch video/audio content. Spike detection is chat-based only.
- 60s lag minimum between a moment happening and it appearing in your queue.

If any of those three matter, the answer is the heavy plan with an always-on VPS — that's outside Lovable's scope.
