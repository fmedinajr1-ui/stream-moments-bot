# Why nothing is clipping for Deen

Two independent bugs are stacking:

**1. The chat WebSocket never receives messages on Cloudflare Workers.**
`src/lib/kick-ws.server.ts` uses `new WebSocket(url)`. Cloudflare Workers do **not** support outbound WebSocket connections via the standard constructor — outbound WS must use the `fetch()` + `Upgrade: websocket` pattern and read `response.webSocket`. The current code "connects" (constructor doesn't throw on the dev runtime) but no frames arrive in production, which is exactly what we see: every `chat_velocity` row is `msgs_per_sec = 0`, `sample_messages = []`.

**2. `getRecentClips` only returns viewer-created clips.**
Even when chat is spiking, Kick's `/api/v2/channels/{slug}/clips` only lists clips that someone manually created. During a live moment, that list is usually empty, so even with a working spike signal we have nothing to score.

# The fix (two parts)

## Part A — Rewrite the WS sampler to use Workers' fetch-upgrade

`src/lib/kick-ws.server.ts`:
- Replace `new WebSocket(PUSHER_URL)` with:
  ```ts
  const resp = await fetch(PUSHER_URL, { headers: { Upgrade: "websocket" } });
  const ws = resp.webSocket;
  if (!ws) return finish("no webSocket on response");
  ws.accept();
  ```
- Keep all existing handlers (`message`, `close`, `error`), the `pusher:subscribe` send on `connection_established`, the `ChatMessageEvent` parser, and the 10s timer — only the construction changes.
- Add one log line on first parsed message (`[kick-ws] first msg for {chatroomId}`) so we can confirm the fix in worker logs without re-querying the DB.

## Part B — Auto-create clips from live VOD on chat spikes

We already have `src/lib/kick-vod.server.ts` and `src/lib/render-runner.server.ts` (Shotstack). Wire them into the spike path:

`src/lib/chat-pulse.server.ts`:
- When `isSpike === true`, after inserting the `chat_velocity` row, call a new helper `triggerSpikeClip(src, velocityRow)` that:
  1. Resolves the streamer's current live VOD URL via `kick-vod.server.ts`.
  2. Computes `start_offset_sec` = (stream uptime − ~20s lead-in) and `duration_sec` = 30s.
  3. Inserts a `clips` row with `status='processing'`, `matched_velocity_id`, `chat_spike_ratio`, AI-scored `hook_caption` / `virality_score` (reuse `scoreClip` from `poll-kick.server.ts`, refactored into a shared `src/lib/score.server.ts`).
  4. Inserts a `render_jobs` row and kicks Shotstack via `render-runner.server.ts`.
- Keep the existing `pollSources` viewer-clip path intact — they're complementary (one catches viewer clips, one catches our own spike clips).

## Part C — Manual safety net

While Part B is being verified, surface a "CLIP NOW" button on the source card (`src/routes/_app.sources.tsx`) that calls a new `clipNowFromLive({ sourceId, durationSec=30 })` server fn — same VOD-cut logic as Part B but triggered by hand. This means even if spike detection underperforms, you can grab a moment from Deen's stream immediately.

## Out of scope
- Re-scoring or back-editing existing clips.
- Changing the cron cadence.
- Touching the `pollSources` clips-API path.

# Files touched
```text
src/lib/kick-ws.server.ts        (rewrite WS construction)
src/lib/score.server.ts          (new — extract scoreClip)
src/lib/poll-kick.server.ts      (import scoreClip from new module)
src/lib/chat-pulse.server.ts     (call triggerSpikeClip on is_spike)
src/lib/spike-clip.server.ts     (new — VOD cut + Shotstack kickoff)
src/lib/agent.functions.ts       (new clipNowFromLive server fn)
src/routes/_app.sources.tsx      (CLIP NOW button)
```

# How we'll verify
1. After deploy, hit `/api/public/cron/chat-pulse` and confirm `msg_count > 0` for `deenthegreat` in the response.
2. Watch `chat_velocity` for a row with `is_spike=true`.
3. Confirm a matching `clips` row + `render_jobs` row appears, then a `rendered_video_url` once Shotstack webhook fires.

If A alone restores chat msgs but spikes still don't fire, we lower `spike_sensitivity` for Deen before adding more logic.
