## Fix the Kick chat reader so spikes can fire

**Problem:** `getRecentChat()` always returns `[]` for `rampagejackson`, so every poll records `msgs_per_sec = 0`, no spikes are detected, and no clips are ever queued. Root cause: we're hitting `https://kick.com/api/v2/channels/{chatroomId}/messages` (wrong path — `chatroomId` is not a channel slug) and Kick/Cloudflare returns nothing usable.

### What I'll change

**1. `src/lib/kick.server.ts` — rewrite `getRecentChat`**
- Resolve `chatroom.id` from `/api/v2/channels/{slug}` (already works).
- Switch the messages call to the correct endpoint: `https://kick.com/api/v2/chatrooms/{chatroomId}/messages`.
- If that returns empty/blocked, fall back to `https://kick.com/api/v1/channels/{slug}/messages` as a secondary.
- Send browser-like headers (real `User-Agent`, `Accept-Language`, `Referer: https://kick.com/{slug}`, `Origin: https://kick.com`) so Cloudflare is less likely to strip the body.
- Tolerant parsing across the shapes Kick returns (`data.messages`, `data.data`, plain array).
- Return up to ~50 most recent messages.

**2. Visibility so we can tell *why* it's empty**
- In `kickFetch`, when a non-OK status is returned, log status + first 200 chars of body (currently we silently return `null`).
- In `getRecentChat`, log which endpoint variant succeeded and how many messages came back. If all variants return empty, log that explicitly with the chatroom id used.
- In `runChatPulse` (`src/lib/chat-pulse.server.ts`), when `msgs.length === 0`, write that into the `sample_messages` field as `[{ user: "_debug", text: "no messages from kick api" }]` so it shows up in the DB without changing the schema. (Optional — confirm before I add it.)

**3. No DB schema changes, no UI changes.** Cron and scoring pipeline are untouched — once chat actually flows in, the existing spike detection + scoring + insert path runs as designed.

### How we'll verify

1. After the edit deploys to the published URL, hit `POST /api/public/cron/chat-pulse` once.
2. Check `chat_velocity` for `rampagejackson`'s source — `msgs_per_sec` should be > 0 and `sample_messages` populated.
3. Check worker logs for the new `[kick]` lines to confirm which endpoint is serving messages.
4. Wait for a real spike (or temporarily lower `spike_sensitivity` on that source) and confirm a row lands in `clips`.

### Out of scope (separate follow-up if needed)

- "Force clip now" manual trigger button (option 2 from the previous question). Say the word and I'll add it after this lands.
- Switching to Kick's websocket Pusher chat feed — heavier change, only worth it if the REST endpoint stays unreliable after this fix.
