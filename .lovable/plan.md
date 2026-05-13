## Goal

Make auto-monitoring actually run 24/7 — independent of any open browser tab — by scheduling the existing poll endpoint at the database layer.

## Why pg_cron instead of Cloudflare cron triggers

You picked "the scheduler option." On this Lovable stack the supported scheduler is **Supabase `pg_cron` + `pg_net`** calling our public route. It runs in the database, fires every minute regardless of traffic, and needs no `wrangler.jsonc` edits. Outcome is identical to a Cloudflare cron trigger.

## What gets scheduled

Endpoint already exists: `POST /api/public/cron/poll-kick` → calls `pollSources()` → updates `sources.last_polled_at`, detects live streams, ingests Kick clips, scores them, writes to `clips`.

## Schedule

Every **60 seconds**, all sources (the route already iterates `sources` where `is_monitoring = true`).

```
* * * * *   →   POST https://project--f25d50e3-8b88-4a00-abe1-abbf74e02448.lovable.app/api/public/cron/poll-kick
```

Headers: `Content-Type: application/json`, `apikey: <anon key>`. Body: `{}`.

## Steps

1. Enable extensions `pg_cron` and `pg_net` (via migration if not already on).
2. Insert the `cron.schedule(...)` row pointing at the production stable URL with the anon key.
3. Verify after ~90s:
   - `select * from cron.job_run_details order by start_time desc limit 5;` shows successes
   - `sources.last_polled_at` advances every minute
   - Queue page badge flips from `STALLED` to `AUTO-MONITORING · ON`

## Out of scope

- Changing poll logic, scoring, or render pipeline.
- Per-source polling intervals (the route already respects `poll_interval_min`; the cron just gives it a chance to run).
- Cloudflare Worker cron triggers (not needed; pg_cron achieves the same thing on this stack).

## One thing to confirm

The `last_known_live: false` for all 3 streamers means **even with perfect polling, no clips will be created until one of them goes live.** This plan fixes the "is it watching?" problem. It does not manufacture clips out of offline streams — that's expected behavior.
