## OBS Replay Buffer integration

Treat OBS as the new primary live-capture path. Mark Moment + VOD resolver stay as fallbacks.

### How it will work

```text
┌────────────┐   chat spike / MARK MOMENT    ┌──────────────┐
│  Dashboard │ ────────────────────────────▶ │ trigger API  │
└────────────┘                               └──────┬───────┘
                                                    │ OBS WebSocket (SaveReplayBuffer)
                                                    ▼
                                          ┌────────────────────┐
                                          │   OBS on your PC   │
                                          │   (60s buffer)     │
                                          └─────────┬──────────┘
                                                    │ writes .mkv/.mp4 to folder
                                                    ▼
                                          ┌────────────────────┐
                                          │  watcher.js (local)│
                                          │  fs.watch + upload │
                                          └─────────┬──────────┘
                                                    │ POST /api/public/obs-upload
                                                    ▼
                                          ┌────────────────────┐
                                          │   App pipeline:    │
                                          │ clip → Shotstack   │
                                          │   → render → ready │
                                          └────────────────────┘
```

Capture path priority:
1. OBS replay buffer (live, instant — when OBS is running)
2. Mark Moment → VOD resolver (when OBS is offline)
3. Existing Kick clips poller (background)

### What I will build

**1. Watcher script (`tools/obs-watcher/`)**
- `watcher.mjs` — Node script, no install needed beyond Node 18+. Uses `chokidar` to watch the OBS replay output folder. On new file: waits for write to settle, POSTs multipart to `/api/public/obs-upload` with `sourceSlug`, `secret`, `file`. Logs to console + retries on failure.
- `config.example.json` — `{ obsReplayDir, sourceSlug, uploadSecret, appUrl }`.
- `README.md` — setup steps: install Node, copy config, `node watcher.mjs`.
- `trigger.mjs` — small companion that connects to OBS WebSocket (`ws://127.0.0.1:4455`) and exposes a tiny local HTTP server (`http://127.0.0.1:7878/save`) that forwards `SaveReplayBuffer` to OBS. The app's server cannot reach your home machine directly; the trigger flow uses an outbound long-poll instead (see #3).

**2. New upload endpoint (`/api/public/obs-upload`)**
- Mirrors the existing `/api/public/upload-clip` shape but auth is a shared `OBS_UPLOAD_SECRET` header instead of the browser-capture token (no browser involvement).
- Accepts `.mkv`, `.mp4`, `.webm`. Resolves `sourceSlug` → `source_id`. Inserts `clips` row (`capture_method: "obs_replay"`, `auto_grabbed: true` when triggered automatically), uploads to the existing `clips` storage bucket, then `startRenderForClip(...)` for Shotstack — same downstream pipeline as today.

**3. Auto-trigger (long-poll, no tunnel needed)**
- New endpoint `/api/public/obs-trigger-poll?sourceSlug=...` (auth: same secret). The trigger.mjs companion long-polls this endpoint (30s timeout). When a chat spike or Mark Moment fires server-side, the app pushes a `{ "action": "save_replay" }` payload into a new `obs_trigger_queue` table; the poll endpoint dequeues and returns it. Companion calls OBS WebSocket `SaveReplayBuffer`. This avoids ngrok/tunnel setup entirely.
- DB hook: when `chat_velocity` row inserts with `is_spike=true`, push to queue. Same when `MARK MOMENT` is clicked (via existing `markMoment` server fn — extend it to enqueue).

**4. Dashboard changes**
- Add a small **OBS STATUS** chip per source: `CONNECTED` (companion polled within 60s) / `OFFLINE`. Driven by a `last_polled_at` column on a new `obs_clients` table.
- Keep MARK MOMENT button. When OBS is connected, label changes to `MARK MOMENT (OBS)`; otherwise `MARK MOMENT (VOD)`.
- New clips show `capture_method: obs_replay` badge.

**5. Database migration**
- `obs_trigger_queue` (id, source_id, action, payload jsonb, claimed_at, created_at).
- `obs_clients` (id, source_slug, last_polled_at, last_save_at).
- Add `OBS_UPLOAD_SECRET` to project secrets.

### Files

New:
- `tools/obs-watcher/watcher.mjs`, `trigger.mjs`, `config.example.json`, `README.md`
- `src/routes/api/public/obs-upload.ts`
- `src/routes/api/public/obs-trigger-poll.ts`
- `src/lib/obs-trigger.server.ts` (enqueue helper)
- `supabase/migrations/<ts>_obs_pipeline.sql`

Edited:
- `src/components/live-watch-grid.tsx` — OBS status chip + label tweak
- `src/lib/marked-moments.functions.ts` — also enqueue OBS save when client connected
- `src/lib/chat-pulse.server.ts` — enqueue OBS save on spike

Untouched: existing Mark Moment / VOD resolver / Kick clip poller — they stay as fallbacks.

### What you'll do once

1. Install OBS, add Kick browser source, enable Replay Buffer (Settings → Output → Replay Buffer, 60s).
2. Install obs-websocket plugin (bundled in OBS 28+), set a password.
3. `cd tools/obs-watcher && cp config.example.json config.json && edit it && node watcher.mjs` (and `node trigger.mjs` in a second terminal — or one combined `node start.mjs`).
4. Leave OBS + the watcher running. That's it.

### Out of scope for this round

- Packaging the watcher as an installable .exe / .app (Node script is fine for now).
- Multi-machine / multi-source OBS (one OBS instance per machine; can extend later).
