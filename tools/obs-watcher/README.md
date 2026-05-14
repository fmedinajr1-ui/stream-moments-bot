# OBS Watcher

Two tiny Node scripts that turn OBS into the live-capture engine for this app.

- **watcher.mjs** — watches your OBS replay-buffer folder and uploads each new clip to the app.
- **trigger.mjs** — long-polls the app and tells OBS to `SaveReplayBuffer` when a chat spike or MARK MOMENT fires.

## One-time setup

1. **OBS** (≥ 28):
   - Add your Kick browser source (`https://kick.com/<slug>` or embed URL).
   - **Settings → Output → Replay Buffer**: enable, set 60s, pick an output folder.
   - **Tools → WebSocket Server Settings**: enable, set a password, default port `4455`.
   - Start the replay buffer (button in OBS main window).
2. **Node 18+** installed (`node --version`).
3. Copy config:
   ```bash
   cd tools/obs-watcher
   cp config.example.json config.json
   ```
   Fill in `appUrl`, `uploadSecret` (the `OBS_UPLOAD_SECRET` you set in Lovable),
   `sourceSlug` (the Kick channel slug, must match a row in `sources`),
   `obsReplayDir` (the folder OBS writes replays to), and the OBS WebSocket
   `url` + `password`.

## Run

In two terminals:

```bash
node watcher.mjs
```
```bash
node trigger.mjs
```

Leave OBS + both scripts running. New replays will appear as clips in the dashboard with `capture_method: obs_replay`.

## How it fits

- App detects a chat spike or you click MARK MOMENT → enqueues `save_replay`.
- `trigger.mjs` polls, picks up the command, calls OBS `SaveReplayBuffer`.
- OBS writes the file → `watcher.mjs` uploads it → app renders via Shotstack.
- Mark Moment + VOD resolver still work as a fallback when OBS is offline.
