# GREATS CLIPPER — Build Plan

A fight-night terminal dashboard that monitors Kick streams, scores energetic moments with AI, and lets you approve clips into a downloadable library. No social posting APIs.

## Reality check (read first)

A few honest constraints that shape this build:

1. **Kick has no official API.** We'll use unofficial endpoints (`kick.com/api/v2/channels/{slug}` and `/clips`). These can break without warning. We isolate them behind one adapter file so a fix is one place.
2. **True live-audio analysis (volume spikes, ffmpeg) cannot run in the Lovable serverless runtime.** Instead, "energetic moment detection" works by polling Kick's own auto-generated clips (Kick creates these when chat erupts — that's already the signal we want), then layering AI + chat-velocity scoring on top. This is actually a stronger signal than raw audio in practice.
3. **Video rendering with burned-in overlay** also needs ffmpeg/Remotion Lambda — out of scope for this runtime. We deliver: original clip download + a CSS/SVG overlay preview in-browser + a JSON "render manifest" the user can pipe into CapCut later. Real burn-in is a flagged future step.
4. **Download-only library** replaces the publishing step: approved clips land in Lovable Cloud Storage with a metadata sidecar (caption, hashtags, score). User downloads and posts manually.

If you want a real audio/render pipeline, that's a separate project on a Node host (Railway/Fly) with ffmpeg — happy to plan that after.

## Architecture

```
Kick (unofficial)  ──poll every 5min──▶  Cron server route
                                              │
                                              ▼
                                       Lovable Cloud (DB)
                                              │
                                              ▼
                                  AI scorer (Lovable AI Gateway,
                                  Gemini 3 Flash) — uses clip
                                  title, view count, chat velocity,
                                  transcript if available
                                              │
                                              ▼
                              clips table (status='pending')
                                              │
                       ┌──────────────────────┼──────────────────────┐
                       ▼                      ▼                      ▼
                  QUEUE (review)        Approve button         Reject
                                              │
                                              ▼
                            Storage: clip.mp4 + metadata.json
                                              │
                                              ▼
                                     Library (download)
```

## Build order

### Step 1 — Scaffold + design system
- Replace placeholder `src/routes/index.tsx` with the QUEUE page (default landing).
- Set up fight-night design tokens in `src/styles.css`: pure black bg, blood red `#FF0033`, championship gold `#FFD700`, sharp 0-radius corners, Bebas Neue + JetBrains Mono via Google Fonts in `__root.tsx` head.
- Build the sidebar layout route (`_layout.tsx` wrapping all 7 pages) with nav, agent status pill, and live stream status bar.
- Create empty route shells for: `/sources`, `/template`, `/schedule`, `/analytics`, `/campaigns`, `/settings`, `/library` (replaces "publish destination").
- Scanline overlay + red-glow logo radial — pure CSS.

### Step 2 — Enable Lovable Cloud + schema
Tables:
- `sources` — id, slug ('deenthegreat'), display_name, is_monitoring, poll_interval_min, last_polled_at, last_known_live, follower_count, avg_viewers
- `clips` — id, source_id, kick_clip_id (unique), kick_clip_url, video_url, thumbnail_url, title, duration_seconds, kick_view_count, stream_timestamp, virality_score, score_breakdown (jsonb: reaction/chat/audio), hook_caption, status ('processing'|'pending'|'approved'|'rejected'|'rejected_auto'|'downloaded'), platforms (jsonb), created_at, approved_at
- `chat_velocity` — clip_id, msgs_per_sec, peak_window, sample_messages (jsonb)
- `templates` — id, name, settings (jsonb), is_active
- `agent_settings` — singleton row: min_score_threshold, max_clips_per_day, is_paused, blocked_keywords[]
- `audit_log` — id, action, clip_id, details, created_at
- `download_history` — clip_id, downloaded_at, format

RLS: single-user app for now → policies tied to authenticated user. Add Lovable Cloud auth (email magic link) so the dashboard isn't public.

### Step 3 — QUEUE page (most important)
Per spec: filter bar, 2-col grid, clip cards with 9:16 video, gold virality score, score breakdown chips, editable Bebas-Neue caption, approve/regenerate/reject row. Spacebar = approve focused card. Batch-approve mode. Empty state with pulsing red dot.

The video preview plays the raw Kick clip URL (no overlay burn-in). A toggle button overlays the fight-night template via absolutely-positioned divs on top of the `<video>` so the user sees the final look without rendering.

### Step 4 — Kick adapter + cron
- `src/lib/kick.server.ts`: `fetchChannel(slug)`, `fetchClips(slug, since)`, `fetchChatSample(channelId, durationSec)`. Wraps unofficial endpoints with retry + graceful fallback.
- `src/routes/api/cron/poll-kick.ts` (server route, secured with a `CRON_SECRET` header): iterates `sources` where `is_monitoring`, fetches new clips, inserts with `status='processing'`, kicks off scoring inline.
- `src/routes/api/cron/score-clip.ts`: takes clip_id, gathers signals, calls Lovable AI Gateway (`google/gemini-3-flash-preview`) with a structured-output schema returning `{score, reaction, chat, audio_estimate, hook_caption}`. Updates row.
- The "audio" sub-score is estimated from Kick's clip view-velocity + chat sample, not from real audio decoding — labeled honestly in the breakdown tooltip.

You'll trigger the cron from an external scheduler (cron-job.org or pg_cron) hitting the stable `project--{id}.lovable.app` URL with the secret header. I'll generate the URL and instructions in Settings.

### Step 5 — Sources, Template, Schedule, Analytics, Campaigns, Settings
Per spec, with these adjustments:
- **SCHEDULE** becomes "PIPELINE" — shows clips moving processing → pending → approved → downloaded. No external posting calendar (we don't post).
- **ANALYTICS** drops platform-view metrics (we don't post). Replaced with: clips/day, approval rate, avg score by streamer, top approved clips. Real data from `clips` + `download_history`.
- **CAMPAIGNS** stays as a CRUD list (manual entry — no campaign API integrations).
- **SETTINGS**: agent threshold/max-per-day/pause, blocked keywords, cron URL + secret display, source management. No social-account connections section.

### Step 6 — LIBRARY page (replaces publishing)
- Grid of approved clips.
- "Download MP4" button — fetches Kick clip via server proxy route (avoids CORS), streams to user.
- "Download metadata.json" — caption, hashtags, score, source, suggested platforms.
- "Download CapCut manifest" — JSON describing overlay text/positions matching active template, importable manually.
- Bulk-download as ZIP for top-N clips.

### Step 7 — Polish
- Spacebar approval, batch mode, audit log table, mobile responsive (sidebar → bottom nav), PWA manifest.
- Public read-only stats page at `/public/stats/$slug` — server route bypasses auth via `/api/public/`-style pattern.
- Daily summary stored in DB, viewable on dashboard (no email — would need Resend setup; flag as optional add-on).

## Technical details

**AI calls:** Lovable AI Gateway via Vercel AI SDK, server routes only. Default `google/gemini-3-flash-preview`. Structured output via `Output.object` + Zod for scoring. `LOVABLE_API_KEY` auto-provisioned when Cloud is enabled.

**Cron:** Lovable's Worker SSR has no native scheduler. Two options:
- (a) External free service (cron-job.org) hits `/api/cron/poll-kick` every 5 min with `x-cron-secret` header. **Recommended.**
- (b) pg_cron via Lovable Cloud DB. Slightly more setup; I'll wire (a) and document (b).

**Secrets needed (I'll request via the secrets tool when we get to Step 4):**
- `CRON_SECRET` — random string you generate, used to authenticate cron pings.
- (Lovable AI key is auto-managed.)

**Kick fragility mitigation:** every Kick adapter call wrapped in try/catch, failures logged to `audit_log`, surfaced in Settings as "Kick adapter health: OK / Degraded". When endpoints break, fix is one file.

**File constraints honored:** routes live in `src/routes/` (flat dot convention), no `src/pages/`, every protected server fn called from a component or `_authenticated/` loader, design tokens in `src/styles.css` only.

## What I will NOT build (and why)

- Real-time audio waveform analysis → needs ffmpeg, can't run on Worker.
- Burned-in template render output → needs Remotion Lambda or Creatomate, separate paid service.
- IG/TikTok/YouTube posting → per your request.
- Email summaries → needs Resend/SMTP secret; mention as one-line add-on.

## Estimated session length
Steps 1–3 in this turn after approval, then 4–7 across follow-up turns so you can review the queue UI before the cron goes live.

Approve and I'll start with Steps 1–3.
