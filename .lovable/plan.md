## Why every clip is the same video

The render runner is supposed to capture from the live edge when the channel is live, and only fall back to VOD when the stream is offline. In practice, **every grab is falling into the VOD path with a bogus offset**, and then the HLS slicer silently snaps to the start of the VOD — so every render captures roughly the same opening seconds.

Evidence from `render_jobs`:

```
ADRIEN BRONER MANUAL GRAB    offset 159990s  (~44h)   same VOD URL every grab
ADRIEN BRONER MANUAL GRAB    offset 159990s          (different clicks, identical offset)
ADRIEN BRONER MANUAL GRAB    offset 160272s
DEENTHEGREAT LIVE CAPTURE    offset 150155s  (~41h)   same VOD URL every grab
DEENTHEGREAT LIVE CAPTURE    offset 152485s
```

Two compounding bugs in the pipeline:

1. **Live detection is failing.** `getKickLivePlaybackUrl(slug)` is hitting Kick's API from the Cloudflare Worker and getting blocked / no playback URL, so the runner silently falls through to `resolveVodAt(slug, now)`.
2. **`resolveVodAt` returns an in-progress VOD.** Kick exposes the still-recording session as a VOD with a constantly growing `duration`, so the `(now - vodStart)` offset comes out as 40+ hours — way past the actual archived segment count.
3. **`captureHlsToStorage` silently clips offset 0 when the offset is past the end.** In `parseMedia` the loop initialises `startIdx = 0` and only updates it if `acc + segDur >= startOffsetSec`. If the offset is past the playlist's total duration, `startIdx` stays at `0` and we capture the **very first 30s of the archive every time** — which is why every clip looks identical.

## Fix plan

### 1. Make `captureHlsToStorage` fail loudly instead of silently grabbing from start
`src/lib/hls-capture.server.ts`: if `startOffsetSec` is provided and exceeds the playlist's total covered seconds (minus `durationSec`), return `{ ok: false, error: "offset beyond playlist length (Xs requested, Ys available)" }`. No more silent fallback to offset 0. Also clamp to `min(startIdx, segments.length - ceil(duration/segDur))` so a "valid but late" offset still gets a real slice.

### 2. Trust `sources.last_known_live` over the per-call HTTP probe
`src/lib/render-runner.server.ts`: before running `getKickLivePlaybackUrl`, read `sources.last_known_live` + `last_polled_at`. If it's `true` and polled in the last few minutes, **commit to live mode** and try harder for a playback URL (retry the existing endpoints with backoff, also try the `/livestream` shape we already list). If after retries we still have no playback URL, fail the render with a clear error — do **not** fall through to VOD. This is the primary defence against the "VOD with 44h offset" behaviour.

### 3. Only use VOD for genuinely-offline backfill
Keep the VOD path, but only use it when `sources.last_known_live = false`. When we do, validate against the resolved `durationSec`: if `(now - vodStart) > durationSec`, the VOD doesn't actually cover the moment yet — return a clear error ("VOD not yet archived for this moment") instead of submitting a bogus offset.

### 4. Surface failures in the UI
`recent-grabs-timeline.tsx` / library cards: when the latest `render_jobs` row for a clip is `failed`, show the `error_message` on the card (instead of just "RENDERED"). This keeps us from quietly accumulating duplicates again.

### 5. Audit + reprocess existing duplicates
Add a one-shot server fn (admin-only button in Settings) that lists clips whose `rendered_video_url` was produced from an offset > playlist length, marks them `status='failed_duplicate'`, and clears `rendered_video_url` so they can be re-grabbed once we can actually reach the live edge.

## Out of scope
- Replacing Kick API access with a third-party proxy. If retries from the Worker still get 403'd we'll surface that separately and discuss residential proxies.
- Changing the Shotstack render template.

## Open question
For step 2, when `last_known_live = true` but Kick still won't return a playback URL from the Worker, do you want the grab to (a) **fail immediately with a visible error**, or (b) **queue and retry** for a few minutes in case it's a transient block?