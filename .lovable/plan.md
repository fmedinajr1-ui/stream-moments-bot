## Goal

When you click APPROVE on a clip in the queue, automatically:
1. Find the source VOD on Kick
2. Cut a 30-60s window centered on the chat-spike timestamp
3. Crop to 9:16 (1080x1920) and burn in the AI hook caption on the first 3s
4. Store the final MP4 in Lovable Cloud and expose a download button

## Critical constraint

ffmpeg cannot run on Lovable's serverless runtime (no native binaries). All video work must be delegated to an external render API. Plan uses **Shotstack** (well-documented JSON edit API, async render + webhook).

## Architecture

```text
APPROVE click
   │
   ▼
setClipStatus('approved')
   │
   ▼
queueRender(clipId)  ──►  render_jobs row (status=pending)
   │
   ▼
kickVodLookup(slug, stream_timestamp)
   │  resolves: vod_url + offset_seconds
   ▼
shotstack.render({ source, trim, crop, caption })
   │  returns render_id
   ▼
render_jobs.status = 'rendering', shotstack_id stored
   │
   ▼  (Shotstack webhook ~30-90s later)
POST /api/public/hooks/shotstack
   │
   ▼
download MP4 → upload to Storage('clips/{clip_id}.mp4')
   │
   ▼
clips.video_url = signed_url, render_jobs.status = 'done'
   │
   ▼  Realtime push → queue card shows DOWNLOAD button
```

## Database changes

New table `render_jobs`:
- `clip_id` (fk to clips)
- `status` (pending | rendering | done | failed)
- `provider` ('shotstack')
- `provider_render_id`
- `vod_url`, `start_offset_sec`, `duration_sec`
- `output_url` (final signed Supabase Storage URL)
- `error_message`
- `created_at`, `completed_at`

New storage bucket `clips` (private, signed-URL access).

Extend `clips` table: add `rendered_video_url` (text, nullable) — distinct from the existing `video_url` which holds the raw Kick clip URL.

## Files to create

- `src/lib/shotstack.server.ts` — wrapper around Shotstack render + status APIs
- `src/lib/kick-vod.server.ts` — given a source slug + stream timestamp, find the VOD URL and compute the offset (uses Kick's `/channels/{slug}/videos` endpoint, picks the VOD whose `created_at <= stream_timestamp <= created_at + duration`)
- `src/lib/render.functions.ts` — `queueRender`, `getRenderStatus`, `retryRender` server functions
- `src/routes/api/public/hooks/shotstack.ts` — webhook receiver, signature-verified, downloads MP4 and uploads to Storage

## Files to edit

- `src/lib/clips.functions.ts` — `setClipStatus` calls `queueRender` when status flips to `approved` and there is no existing successful render
- `src/components/clip-card.tsx` — show render badge (PENDING / RENDERING / READY / FAILED), DOWNLOAD button when ready, RETRY button when failed
- `src/routes/_app.index.tsx` — subscribe to `render_jobs` realtime channel, refresh card on update

## Trim window logic

- Default: `start = stream_timestamp - 25s`, `duration = 45s`
- If `chat_spike_ratio` exists and a `chat_velocity` row matched, center on the spike's `created_at` instead
- Clamp duration to 15-60s; clamp start ≥ VOD start

## Render edit (Shotstack JSON, summary)

- Input: VOD HLS URL with `trim` start + length
- Filter: `crop` to centered 9:16 (1080x1920)
- Overlay: text track for first 3s with `hook_caption`, bold, drop shadow, bottom-third
- Output: mp4, 1080x1920, 30fps

## Secrets needed

Will request via `add_secret` during implementation:
- `SHOTSTACK_API_KEY` (from shotstack.io/dashboard)
- `SHOTSTACK_WEBHOOK_SECRET` (any random string; configured in Shotstack dashboard)

## Failure handling

- VOD lookup fails (stream not yet archived) → `render_jobs.status = 'failed'`, error "VOD not yet available, retry in ~10 min". UI shows RETRY button.
- Shotstack render fails → status 'failed' with provider error message.
- Webhook timeout (>15 min) → `render-watchdog` cron every 5 min polls Shotstack for stuck jobs.

## Cost & latency expectations

- ~$0.30 per approved clip on Shotstack
- 30-90s from APPROVE → DOWNLOAD button live
- Storage: ~5MB per 45s 1080x1920 clip

## Verification steps

1. Approve a clip whose source has an archived VOD → within 2 min a DOWNLOAD button appears, MP4 downloads as 1080x1920 with caption burned in on first 3s
2. Approve a clip from a still-live stream (no VOD yet) → render_jobs marked failed with clear message, RETRY works after VOD posts
3. Reject a clip → no render queued (no cost)
4. Webhook receives bad signature → 401, no DB write
5. Re-approve an already-rendered clip → no duplicate render, existing URL reused

## Out of scope (intentional)

- Live HLS capture (needs always-on VPS)
- Auto-publish to TikTok/IG/YT (separate feature)
- Multi-segment edits / B-roll
- Custom caption styling per template (uses one default style)
