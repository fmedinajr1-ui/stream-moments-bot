## What's broken

The resolver cron `/api/public/cron/resolve-moments` has been failing on **every run** with:

> Could not find a relationship between 'marked_moments' and 'sources' in the schema cache

Cause: `marked_moments.source_id` has no foreign key to `sources(id)`, but `marked-moments.server.ts` does a nested PostgREST select (`sources(slug, display_name)`) that requires one. As a result:

- 6 marked moments are stuck in `status: pending` (none have ever been touched — `attempts = 0`, no `last_error`)
- The `audit_log` has zero `resolve_moments_tick` rows ever
- Cron is correctly scheduled (`*/5 * * * *`) and firing — it just 500s every time

The auto-mark side is wired up correctly. Chat is currently silent (0 msgs/sec across all 3 sources), so no spike has fired yet — but the older "Mark Moment" rows prove the resolver path is broken regardless.

## Fix (one migration + verification)

1. **Add the missing FK**
   ```sql
   ALTER TABLE public.marked_moments
     ADD CONSTRAINT marked_moments_source_id_fkey
     FOREIGN KEY (source_id) REFERENCES public.sources(id) ON DELETE CASCADE;
   ```
   Also add an index on `source_id` (cooldown lookups already query it).

2. **Re-invoke the resolver** and confirm:
   - HTTP 200 with a `scanned/resolved/stillPending` summary
   - One of the 6 pending moments transitions to `resolved` (or `retry` if no VOD covers that timestamp yet)
   - A `clips` row is inserted with `capture_method: 'marked_vod'` and a render job kicks off
   - A `resolve_moments_tick` audit row is written

3. **End-to-end spike check** (optional — only if a source goes active during the session). When chat hits the spike threshold, confirm:
   - `audit_log.spike_auto_marked` row appears
   - A new `marked_moments` row in `pending`
   - On the next 5-min cron tick, it resolves into a `clips` row

No code changes are needed in `chat-pulse.server.ts`, `marked-moments.server.ts`, or the cron route — the logic is correct, only the schema relationship is missing.

## Files touched

- `supabase/migrations/<timestamp>_add_marked_moments_source_fk.sql` — add FK + index
