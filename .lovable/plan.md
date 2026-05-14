## Better plan: stop depending on live browser capture

The current approach is failing for two hard reasons:
- Kick’s live HLS URLs are returning `403` from this app’s origin, so the browser cannot reliably play/capture the live stream.
- Kick chat sampling is producing `0 msg/s`, so spike detection has no real signal to trigger from.

Instead of trying to keep patching that path, I’d move the product to a more reliable VOD-first pipeline.

## What I would build

1. **Remove live browser capture as the primary auto-grab path**
   - Keep the embedded player only as a watch/status view.
   - Stop showing “ARMING…” / “WATCHDOG ARMED” as if it can reliably capture.
   - Replace it with clear status like `LIVE VIEW ONLY` / `CAPTURE VIA VOD`.

2. **Make auto-grab use Kick-generated clips/VODs first**
   - The existing poller already watches channels and pulls recent Kick clips.
   - Make this the main source of new pending clips.
   - Score them with the current AI scoring path and put them in the queue automatically.
   - This avoids needing our browser to record the live player.

3. **Turn spike detection into an enhancement, not the capture dependency**
   - Keep the Spike Tracker panel, but make it honest: if chat velocity is unavailable, show `CHAT SIGNAL UNAVAILABLE` instead of `0.0/s`.
   - If chat data becomes available later, use it to boost scores and annotate clips.
   - Do not block clip creation on spike data.

4. **Add a manual “mark moment” workflow that actually survives failures**
   - Add a `MARK MOMENT` button per live source.
   - When clicked, store the source, timestamp, caption, and duration in a new `marked_moments` table.
   - A backend process later resolves the matching VOD once Kick archives it, then renders the clip from that VOD.
   - This gives you a reliable fallback when live capture is blocked.

5. **Add backend observability so we can see what is working**
   - Show last poll time, last successful source fetch, last clip found, and last render error per source.
   - Add a compact health panel: `Polling`, `Kick clips`, `Chat signal`, `Rendering`.
   - This prevents the current “nothing is showing” black-box situation.

## Technical changes

- Add a `marked_moments` table with fields for source, timestamp, duration, caption, status, resolved clip/render job, and error message.
- Add server functions to:
  - create a marked moment from the UI,
  - list marked moment statuses,
  - retry unresolved moments.
- Add a cron/server route to resolve pending marked moments against VODs after a delay.
- Update `LiveWatchGrid`:
  - remove recorder/watchdog promises from the UI,
  - add `MARK MOMENT`,
  - show clear capture mode/status.
- Update `SpikeTrackerPanel`:
  - distinguish “no chat activity” from “chat source unavailable”,
  - stop implying auto-grab is armed when browser capture cannot work.
- Update render flow:
  - prefer stored raw uploads if present,
  - otherwise use VOD resolution,
  - no longer depend on live cached HLS for normal operation.

## Expected result

- New clips continue appearing from Kick’s clip/VOD pipeline even when live HLS and chat are blocked.
- Manual moments are saved immediately and rendered once VOD data becomes available.
- The dashboard tells you exactly which part is working or failing instead of showing black tiles and `0.0/s` forever.