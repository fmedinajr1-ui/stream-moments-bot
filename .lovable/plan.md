# Live watch + manual clip capture on Queue page

## What we're adding

A live watcher panel at the top of `/` (Queue) so you can see what your monitored streamer is doing in real time, hit a button to grab a clip whenever the moment is good, and feed those manual grabs back to the AI as training signal.

## UI changes

### `src/routes/_app.index.tsx` — new "LIVE NOW" panel above filters

```
┌─────────────────────────────────────────────────────────────┐
│  LIVE NOW                                                    │
│  [streamer dropdown ▼]  ● LIVE • 12.4k viewers              │
│                                                              │
│  ┌─────────────────────────────┐   CAPTURE THIS MOMENT       │
│  │                             │   ┌──────────────────────┐  │
│  │   <Kick iframe player>      │   │ caption (optional)   │  │
│  │   16:9, autoplay muted      │   └──────────────────────┘  │
│  │                             │   duration: [15 30 45]      │
│  └─────────────────────────────┘   [ ▶ GRAB CLIP NOW ]       │
│                                                              │
│  Last manual grab: 2m ago • DEENTHEGREAT laughing fit       │
└─────────────────────────────────────────────────────────────┘
```

- Player: `<iframe src="https://player.kick.com/{slug}?muted=true&autoplay=true">`
- Streamer dropdown only lists sources where `last_known_live = true` (falls back to all monitored if none live).
- "GRAB CLIP NOW" calls a new server fn → reuses `createSpikeClip()` with `hookCaption` from the textarea and `timestampIso = now()`.
- A small toast confirms ("CLIP QUEUED — RENDERING") and the new clip flows into the queue below within ~30s like any other.

### Queue card already exists — no change there.

## Server changes

### `src/lib/clips.functions.ts` — new `manualGrabClip`
```ts
export const manualGrabClip = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({
    sourceId: z.string().uuid(),
    caption: z.string().max(80).optional(),
    durationSec: z.number().min(15).max(60).default(30),
  }).parse(d))
  .handler(async ({ data }) => {
    const { data: src } = await supabaseAdmin
      .from("sources").select("slug").eq("id", data.sourceId).single();
    if (!src) throw new Error("source not found");
    return createSpikeClip({
      sourceId: data.sourceId,
      slug: src.slug,
      hookCaption: data.caption,
      // No spikeRatio / msgsPerSec — this is human-flagged.
    });
  });
```

The clip lands with `score_rationale = "Manual live capture"` (already handled in `spike-clip.server.ts`), so we can later filter `clips WHERE score_rationale LIKE 'Manual%'` for training data.

### `src/lib/clips.functions.ts` — new `listLiveSources`
Small helper for the dropdown — returns `{ id, slug, display_name, last_known_live, avg_viewers }` from `sources` ordered by `last_known_live DESC, display_name ASC`.

## On the "capture through the player instead of Kick" idea

I want to be straight with you before building it: **the browser can't record the Kick iframe**. It's cross-origin and (where DRM is active) protected. The two viable paths are:
- **Keep server-side HLS capture** (current path) — already works when the live `playback_url` resolves; we just hardened it against Cloudflare 403s. This is what `manualGrabClip` will use.
- **You-as-relay** (much later, optional): run a tiny Node helper on your machine that pulls the HLS and pushes segments to our Storage. Works around Cloudflare entirely but needs you to keep the helper running.

For now, `manualGrabClip` gives you the "I see it, grab it" workflow without changing the capture pipeline. If Kick blocks our server's live URL fetch at the moment you click, the clip row is still created with status `failed` and a clear error — and the moment timestamp is preserved as training data either way.

## Training feedback loop (free with this change)
Every manual grab is implicitly a positive label. Later we can:
- Compare `chat_velocity` rows around manual-grab timestamps vs. spike-only grabs to learn what chat patterns YOU find clip-worthy.
- Tune `agent_settings.min_score_threshold` per streamer based on grab/reject ratios.

Out of scope for this turn — flag it when you want it.

## Files touched
- `src/routes/_app.index.tsx` — add LiveWatch panel
- `src/lib/clips.functions.ts` — add `manualGrabClip`, `listLiveSources`
- (no DB migration needed)
