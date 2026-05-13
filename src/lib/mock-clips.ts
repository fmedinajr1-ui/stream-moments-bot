/**
 * Mock clip data — used until the real Kick poller (Step 4) populates the table.
 * Shape matches the `clips` table.
 */
export type MockClip = {
  id: string;
  source_streamer: string;
  source_handle: string;
  stream_timestamp: string;
  date_label: string;
  virality_score: number;
  score_breakdown: { reaction: number; chat: number; audio: number };
  hook_caption: string;
  duration_seconds: number;
  video_url: string;
  thumbnail_url: string;
  chat_spike_ratio?: number | null;
  score_rationale?: string | null;
  render_status?: "pending" | "rendering" | "done" | "failed" | null;
  render_error?: string | null;
  rendered_video_url?: string | null;
};

// Public sample 9:16-friendly videos (no audio analysis needed for the mock)
const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

export const MOCK_CLIPS: MockClip[] = [
  {
    id: "mock-1",
    source_streamer: "DEEN",
    source_handle: "@deenthegreat",
    stream_timestamp: "02:34:11",
    date_label: "Feb 17, 2026",
    virality_score: 94,
    score_breakdown: { reaction: 96, chat: 92, audio: 93 },
    hook_caption: "DEEN GETS DROPPED BY LARRY WHEELS",
    duration_seconds: 24,
    video_url: SAMPLE_VIDEO,
    thumbnail_url: "",
  },
  {
    id: "mock-2",
    source_streamer: "RAMPAGE",
    source_handle: "@rampage",
    stream_timestamp: "01:12:48",
    date_label: "Feb 17, 2026",
    virality_score: 88,
    score_breakdown: { reaction: 84, chat: 90, audio: 89 },
    hook_caption: "RAMPAGE LOSES IT AT CHAT",
    duration_seconds: 31,
    video_url: SAMPLE_VIDEO,
    thumbnail_url: "",
  },
  {
    id: "mock-3",
    source_streamer: "AB",
    source_handle: "@ab",
    stream_timestamp: "03:48:02",
    date_label: "Feb 16, 2026",
    virality_score: 82,
    score_breakdown: { reaction: 80, chat: 85, audio: 79 },
    hook_caption: "AB CALLS OUT JAKE PAUL ON STREAM",
    duration_seconds: 19,
    video_url: SAMPLE_VIDEO,
    thumbnail_url: "",
  },
  {
    id: "mock-4",
    source_streamer: "DEEN",
    source_handle: "@deenthegreat",
    stream_timestamp: "00:45:33",
    date_label: "Feb 16, 2026",
    virality_score: 79,
    score_breakdown: { reaction: 78, chat: 82, audio: 76 },
    hook_caption: "BENCH PRESS GOES WRONG MID-STREAM",
    duration_seconds: 28,
    video_url: SAMPLE_VIDEO,
    thumbnail_url: "",
  },
  {
    id: "mock-5",
    source_streamer: "RAMPAGE",
    source_handle: "@rampage",
    stream_timestamp: "04:21:10",
    date_label: "Feb 15, 2026",
    virality_score: 76,
    score_breakdown: { reaction: 72, chat: 80, audio: 75 },
    hook_caption: "MOD GETS BANNED ON CAMERA",
    duration_seconds: 22,
    video_url: SAMPLE_VIDEO,
    thumbnail_url: "",
  },
  {
    id: "mock-6",
    source_streamer: "AB",
    source_handle: "@ab",
    stream_timestamp: "02:08:55",
    date_label: "Feb 15, 2026",
    virality_score: 71,
    score_breakdown: { reaction: 68, chat: 74, audio: 71 },
    hook_caption: "FAN STORMS THE GYM DURING LIVE",
    duration_seconds: 35,
    video_url: SAMPLE_VIDEO,
    thumbnail_url: "",
  },
];
