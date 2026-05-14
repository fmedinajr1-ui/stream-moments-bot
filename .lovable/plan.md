# Fix: live clips pulling stale archive + oversized captions

## What's actually happening

Both questions trace to the same render path.

### 1. "Are these old clips?"
Yes — kind of. Every recent render hit this VOD URL:

```
.../2026/5/12/23/44/.../master.m3u8   start_offset_sec ≈ 150,000  (~42h in)
```

Deen's stream has been live since **May 12 23:44 UTC**. Kick exposes the in-progress session as a "video" with a continuously growing `duration`, so `resolveVodAt()` matches it and computes a 42-hour offset into the archive playlist. That archive is real but lags / can return earlier session segments, so the clip plays footage that doesn't match what's on stream right now.

Fix: when the channel is **currently live**, ignore VOD lookup and capture from the **live edge** instead. The live HLS playlist always contains the most recent ~30–60s, which is exactly what a "spike right now" clip should show.

### 2. "Subtitles too large"
In `shotstack.server.ts` the title asset is:
```
style: "future", size: "large", background: "#000000", position: "bottom"
```
On a 1080×1920 9:16 frame that "large" + black bar fills almost the full width and crops words ("EGREAT  LIVE C…" in the screenshot). Needs smaller size, no full-bleed bar, safe-zone padding.

## Changes

### `src/lib/render-runner.server.ts`
- Call `getKickLivePlaybackUrl(slug)` **first**.
- If live URL exists → use live mode (no VOD lookup, `startOffsetSec = null`, capture trailing window).
- Only fall back to `resolveVodAt()` when channel is offline (no live URL).
- Keep the VOD path for past moments / backfill.

### `src/lib/hls-capture.server.ts`
- In `mode: "live"`, when reading the media playlist, drop all but the last `durationSec` worth of segments (current behavior may grab from playlist head). Ensures we capture the actual live edge, not the start of the rolling window.

### `src/lib/shotstack.server.ts` — caption sizing
Replace the title asset block with one tuned for 9:16:
- `size: "small"` (was `large`)
- Remove `background` (no full-width black bar) — rely on text stroke for legibility
- `position: "bottom"` kept, but caption length cap drops from 80 → **42 chars** so it fits one line at 1080 wide
- Optionally swap `style: "future"` → `style: "minimal"` for tighter glyphs

## Out of scope
- Burning word-by-word subtitles from transcription (separate feature).
- Re-rendering the two existing "old" clips — once the fix lands, the next spike will render correctly. I can also re-queue the two failed/old ones with `retryRender` after the change if you want.

## Risk
Low — both files are server-side, behind the existing `render_jobs` retry path. If live capture fails, the runner already records `failed` with an error message and the Library shows a RETRY button.
