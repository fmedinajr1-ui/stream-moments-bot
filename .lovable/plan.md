## Where we are

- Step 4 (Kick adapter + cron poller + AI scoring) is implemented at `/api/public/cron/poll-kick`.
- DB has 3 sources (`deenthegreat`, `rampage`, `ab`), 0 clips, no `last_polled_at` — meaning the poller has not actually been run against the published URL yet.
- A pg_cron schedule was created in the earlier migration, but cron may only fire against the published URL; while in preview, nothing populates `clips`.
- Pages `/sources` and `/` are real; `/library`, `/pipeline`, `/settings`, `/analytics`, `/campaigns` are still `Stub` placeholders.
- User wants: no fake queues. The "batch" should be a real button that actually runs the poll → score → insert pipeline against live Kick data, and the rest of the UI must reflect real DB state.

## Plan — Step 5: Make the batch real and finish the core UI

### 1. Real "Start Batch" trigger (no fake queue)

- Add a server function `runPollNow()` in `src/lib/clips.functions.ts` that directly invokes the same `pollSources()` logic the cron route uses (extract it into `src/lib/poll-kick.server.ts` and import from both places — no HTTP self-call, no fake queue).
- Header on `/` (Queue) gets a real `RUN BATCH NOW` button:
  - On click → calls `runPollNow()` → shows live status (`POLLING deenthegreat…`, `SCORED 4 NEW CLIPS`, etc.) using the returned summary.
  - Disabled while running. Toast on error (rate limit / credits).
- Same button surfaces in `/sources` header.
- Remove the `useMock` fallback in `_app.index.tsx` — show a real empty state ("No clips yet. Hit RUN BATCH NOW or wait for the 5-min cron.") instead of swapping to mock data.

### 2. Sources page — real CRUD

- "+ ADD SOURCE" opens a modal: input Kick slug → calls `getChannel(slug)` server-side to validate → inserts into `sources` with `display_name` from Kick.
- Per-card delete (trash icon). Inline edit of `poll_interval_min`.
- Show real `last_polled_at` (relative time) instead of placeholder.

### 3. Library page — real downloads

- Query `clips` where `status = 'approved'`, ordered by `approved_at desc`.
- Each card: thumbnail, hook caption, score, **Download MP4** (links to `clip.video_url` Kick CDN URL with `download` attribute), **Copy metadata.json** (title, hook, score, source, timestamp, URL), **Copy CapCut manifest** (simple JSON with clip + caption track).
- Records a row in `download_history` per click.

### 4. Settings page — agent controls

- Read/write `agent_settings` row: `min_score_threshold` (slider 50–95), `max_clips_per_day`, `is_paused` toggle, `blocked_keywords` (chip input).
- `is_paused = true` already short-circuits the poller — no extra plumbing needed.

### 5. Pipeline / Analytics / Campaigns

- **Pipeline**: real timeline of recent `audit_log` entries (poll runs, approvals, rejects).
- **Analytics**: real counts from DB — clips in last 7d, approved vs rejected, top source by approved count, avg score. Simple bars, no charting lib.
- **Campaigns**: list/CRUD on the `campaigns` table (add, edit budget, mark complete). Pure DB UI, no external integration yet.

### 6. Verification

- Click `RUN BATCH NOW` from `/` → poll summary returns `polled: 3, new_clips: N` → DB shows new `clips` rows with real `kick_clip_id`, `video_url`, `virality_score` → Queue cards render them → approve one → it appears in `/library` with a working Download MP4.
- Confirm `last_polled_at` updates on `/sources`.
- Confirm pause toggle in `/settings` makes the next batch return `skipped: agent_paused`.

## Technical notes

- Extract poll logic: move body of `pollSources()` from `src/routes/api/public/cron/poll-kick.ts` into `src/lib/poll-kick.server.ts`; both the cron route and the new `runPollNow` server fn import it. Keeps a single source of truth.
- `runPollNow` is `createServerFn({ method: "POST" })` — already auth-bypass-safe because the page is behind `_app/`.
- No background queue, no worker process, no setTimeout fakery — clicking the button awaits the real poll and returns the real summary.
- Downloads use the Kick CDN URL directly (no re-hosting / storage bucket needed for now). If Kick CDN blocks `download` attribute cross-origin, fall back to an `/api/public/download/$clipId` server route that proxies the bytes.

## Out of scope for this step

- Re-encoding clips, watermarking, auto-captioning, social posting (download-only library is the contract).
- Audio/chat ingestion beyond what the AI scorer already infers from title+views (chat-velocity table stays empty until we have real chat capture in a later step).
