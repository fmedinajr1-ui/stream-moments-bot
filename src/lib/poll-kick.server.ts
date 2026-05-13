import { generateText, Output } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { getChannel, getRecentClips, type KickClip } from "@/lib/kick.server";

const ScoreSchema = z.object({
  virality_score: z.number().min(0).max(100),
  reaction: z.number().min(0).max(100),
  chat: z.number().min(0).max(100),
  audio: z.number().min(0).max(100),
  hook_caption: z.string().max(80),
  rationale: z.string().max(280),
});

type SpikeMatch = {
  id: string;
  ratio: number;
  msgs_per_sec: number;
  sample: Array<{ user: string; text: string }>;
} | null;

type Example = {
  title: string;
  caption: string | null;
  score: number | null;
  spike_ratio: number | null;
  label: "APPROVED" | "REJECTED";
};

async function getFewShot(): Promise<Example[]> {
  const [{ data: ap }, { data: rj }] = await Promise.all([
    supabaseAdmin
      .from("clips")
      .select("title,hook_caption,virality_score,chat_spike_ratio")
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("clips")
      .select("title,hook_caption,virality_score,chat_spike_ratio")
      .eq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const ex: Example[] = [];
  (ap ?? []).forEach((c) =>
    ex.push({
      title: c.title ?? "",
      caption: c.hook_caption,
      score: c.virality_score,
      spike_ratio: c.chat_spike_ratio,
      label: "APPROVED",
    }),
  );
  (rj ?? []).forEach((c) =>
    ex.push({
      title: c.title ?? "",
      caption: c.hook_caption,
      score: c.virality_score,
      spike_ratio: c.chat_spike_ratio,
      label: "REJECTED",
    }),
  );
  return ex;
}

function formatExamples(ex: Example[]) {
  if (!ex.length) return "(no past decisions yet — use general best practices)";
  return ex
    .map(
      (e) =>
        `- [${e.label}] score=${e.score ?? "?"} spike=${e.spike_ratio ?? "n/a"}x | "${e.title}"`,
    )
    .join("\n");
}

async function findSpikeMatch(
  sourceId: string,
  whenISO: string,
): Promise<SpikeMatch> {
  const t = +new Date(whenISO);
  const lo = new Date(t - 60_000).toISOString();
  const hi = new Date(t + 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("chat_velocity")
    .select("id, spike_ratio, msgs_per_sec, sample_messages, is_spike")
    .eq("source_id", sourceId)
    .gte("created_at", lo)
    .lte("created_at", hi)
    .order("spike_ratio", { ascending: false })
    .limit(1);
  const row = data?.[0];
  if (!row || !row.is_spike) return null;
  return {
    id: row.id,
    ratio: Number(row.spike_ratio ?? 0),
    msgs_per_sec: Number(row.msgs_per_sec ?? 0),
    sample: (row.sample_messages as any) ?? [],
  };
}

async function scoreClip(
  clip: KickClip,
  spike: SpikeMatch,
  examples: Example[],
  apiKey: string,
) {
  try {
    const gateway = createLovableAiGatewayProvider(apiKey);
    const model = gateway("google/gemini-2.5-flash");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    const spikeBlock = spike
      ? `CHAT SPIKE DETECTED at this moment: ${spike.ratio.toFixed(1)}x baseline (${spike.msgs_per_sec.toFixed(1)} msgs/sec).
Sample chat lines:
${spike.sample.map((s) => `  ${s.user}: ${s.text}`).join("\n")}`
      : "No chat spike matched (chat was at baseline).";

    const { output } = await generateText({
      model,
      abortSignal: ac.signal,
      output: Output.object({ schema: ScoreSchema }),
      prompt: `You are scoring a Kick livestream clip for viral potential on Reels/TikTok/Shorts.
You learn from the user's past approve/reject decisions below — match their taste.

CANDIDATE CLIP
Title: "${clip.title}"
Streamer: ${clip.streamerName}
Duration: ${clip.durationSeconds}s
Kick view count: ${clip.viewCount}

LIVE SIGNAL
${spikeBlock}

USER'S PAST DECISIONS (most recent first):
${formatExamples(examples)}

TASK
Score 0-100:
- virality_score: overall short-form viral potential, weighted to match user's taste shown above
- reaction: emotional/loud-moment intensity inferred from title + chat sample
- chat: chat eruption strength (use spike ratio if present, else infer from views)
- audio: likely audio energy
Then write a punchy ALL-CAPS hook caption (<=60 chars) and a one-sentence rationale that references the spike and/or which past examples it resembles.`,
    });
    clearTimeout(timer);
    return output;
  } catch (err) {
    console.error("[scoreClip] failed", err);
    const base = Math.min(95, 40 + Math.log10(clip.viewCount + 1) * 15);
    const boost = spike ? Math.min(20, Math.round(spike.ratio * 5)) : 0;
    return {
      virality_score: Math.min(100, Math.round(base + boost)),
      reaction: Math.round(base),
      chat: Math.round(base - 5 + boost),
      audio: Math.round(base - 10),
      hook_caption: clip.title.toUpperCase().slice(0, 60) || "WATCH THIS",
      rationale: spike
        ? `Fallback scoring — matched chat spike ${spike.ratio.toFixed(1)}x baseline.`
        : "Fallback scoring (AI unavailable).",
    };
  }
}

export type PollSummary = {
  polled: number;
  new_clips: number;
  sources: Array<{
    slug: string;
    live: boolean;
    new: number;
    skipped?: string;
    error?: string;
  }>;
};

export async function pollSources(opts?: { sourceId?: string }): Promise<PollSummary> {
  const apiKey: string = process.env.LOVABLE_API_KEY ?? "";
  if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

  let q = supabaseAdmin.from("sources").select("*").eq("is_monitoring", true);
  if (opts?.sourceId) q = q.eq("id", opts.sourceId);
  const { data: sources, error: sErr } = await q;
  if (sErr) throw sErr;

  const summary: PollSummary = { polled: 0, new_clips: 0, sources: [] };

  const { data: settings } = await supabaseAdmin
    .from("agent_settings")
    .select("min_score_threshold,is_paused,blocked_keywords,max_clips_per_day")
    .limit(1)
    .maybeSingle();
  const threshold = settings?.min_score_threshold ?? 70;
  const blocked: string[] = settings?.blocked_keywords ?? [];

  // Build few-shot once per poll run
  const examples = await getFewShot();

  const MAX_CLIPS_PER_SOURCE = 5;
  const SCORE_CONCURRENCY = 5;

  async function processSource(src: any): Promise<PollSummary["sources"][number]> {
    const sourceLog: PollSummary["sources"][number] = {
      slug: src.slug,
      live: false,
      new: 0,
    };
    try {
      const channel = await getChannel(src.slug);
      sourceLog.live = !!channel?.isLive;
      await supabaseAdmin
        .from("sources")
        .update({
          last_polled_at: new Date().toISOString(),
          last_known_live: !!channel?.isLive,
          ...(channel
            ? {
                follower_count: channel.followers ?? src.follower_count,
                avg_viewers: channel.viewers ?? src.avg_viewers,
              }
            : {}),
        })
        .eq("id", src.id);

      if (settings?.is_paused) {
        sourceLog.skipped = "agent_paused";
        return sourceLog;
      }
      if (!channel?.isLive) {
        sourceLog.skipped = "offline";
        return sourceLog;
      }

      const clips = await getRecentClips(src.slug);
      if (clips.length === 0) return sourceLog;

      const ids = clips.map((c) => c.id);
      const { data: existing } = await supabaseAdmin
        .from("clips")
        .select("kick_clip_id")
        .in("kick_clip_id", ids);
      const seen = new Set((existing ?? []).map((r) => r.kick_clip_id));
      const fresh = clips
        .filter(
          (c) =>
            !seen.has(c.id) &&
            !blocked.some(
              (kw) => kw && c.title.toLowerCase().includes(kw.toLowerCase()),
            ),
        )
        .slice(0, MAX_CLIPS_PER_SOURCE);

      // Score in chunks of SCORE_CONCURRENCY
      for (let i = 0; i < fresh.length; i += SCORE_CONCURRENCY) {
        const chunk = fresh.slice(i, i + SCORE_CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map(async (clip) => {
            const spike = await findSpikeMatch(src.id, clip.createdAt);
            const score = await scoreClip(clip, spike, examples, apiKey);
            return { clip, spike, score };
          }),
        );
        for (const r of results) {
          if (r.status !== "fulfilled") {
            console.error("[poll] score chunk failed", r.reason);
            continue;
          }
          const { clip, spike, score } = r.value;
          if (score.virality_score < threshold) continue;
          const { error: insErr } = await supabaseAdmin.from("clips").insert({
            source_id: src.id,
            kick_clip_id: clip.id,
            kick_clip_url: clip.url,
            video_url: clip.videoUrl,
            thumbnail_url: clip.thumbnailUrl,
            title: clip.title,
            duration_seconds: clip.durationSeconds,
            kick_view_count: clip.viewCount,
            virality_score: score.virality_score,
            score_breakdown: {
              reaction: score.reaction,
              chat: score.chat,
              audio: score.audio,
            },
            hook_caption: score.hook_caption,
            score_rationale: score.rationale,
            chat_spike_ratio: spike?.ratio ?? null,
            matched_velocity_id: spike?.id ?? null,
            status: "pending",
            stream_timestamp: clip.createdAt,
          });
          if (insErr) {
            console.error("[poll] insert failed", insErr);
          } else {
            sourceLog.new++;
          }
        }
      }
    } catch (err: any) {
      console.error(`[poll] source ${src.slug} failed`, err);
      sourceLog.error = err?.message ?? String(err);
    }
    return sourceLog;
  }

  // Process all sources in parallel — one slow streamer can't block others
  const results = await Promise.allSettled(
    (sources ?? []).map((s) => processSource(s)),
  );
  for (const r of results) {
    summary.polled++;
    if (r.status === "fulfilled") {
      summary.sources.push(r.value);
      summary.new_clips += r.value.new;
    } else {
      summary.sources.push({
        slug: "?",
        live: false,
        new: 0,
        error: String(r.reason),
      });
    }
  }

  await supabaseAdmin
    .from("audit_log")
    .insert({ action: "poll_kick", details: summary as any });

  return summary;
}
