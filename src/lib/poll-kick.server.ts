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
});

async function scoreClip(clip: KickClip, apiKey: string) {
  try {
    const gateway = createLovableAiGatewayProvider(apiKey);
    const model = gateway("google/gemini-3-flash-preview");
    const { output } = await generateText({
      model,
      output: Output.object({ schema: ScoreSchema }),
      prompt: `You are scoring a Kick livestream clip for viral potential on Reels/TikTok/Shorts.
Title: "${clip.title}"
Streamer: ${clip.streamerName}
Duration: ${clip.durationSeconds}s
View count on Kick: ${clip.viewCount}

Score 0-100:
- virality_score: overall short-form viral potential
- reaction: emotional/loud-moment intensity inferred from title
- chat: likely chat eruption (Kick auto-clips often correlate with chat spikes; baseline 60 if views > 500, else 40)
- audio: likely audio energy (yelling, music drop, crowd)
Then write a punchy ALL-CAPS hook caption (<= 60 chars) for the clip.`,
    });
    return output;
  } catch (err) {
    console.error("[scoreClip] failed", err);
    const base = Math.min(95, 40 + Math.log10(clip.viewCount + 1) * 15);
    return {
      virality_score: Math.round(base),
      reaction: Math.round(base),
      chat: Math.round(base - 5),
      audio: Math.round(base - 10),
      hook_caption: clip.title.toUpperCase().slice(0, 60) || "WATCH THIS",
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
  const apiKey = process.env.LOVABLE_API_KEY;
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

  for (const src of sources ?? []) {
    summary.polled++;
    const sourceLog: PollSummary["sources"][number] = {
      slug: src.slug,
      live: false,
      new: 0,
    };

    try {
      const channel = await getChannel(src.slug);
      if (channel) {
        sourceLog.live = channel.isLive;
        await supabaseAdmin
          .from("sources")
          .update({
            last_polled_at: new Date().toISOString(),
            last_known_live: channel.isLive,
            follower_count: channel.followers ?? src.follower_count,
            avg_viewers: channel.viewers ?? src.avg_viewers,
          })
          .eq("id", src.id);
      } else {
        await supabaseAdmin
          .from("sources")
          .update({ last_polled_at: new Date().toISOString() })
          .eq("id", src.id);
      }

      if (settings?.is_paused) {
        sourceLog.skipped = "agent_paused";
        summary.sources.push(sourceLog);
        continue;
      }

      const clips = await getRecentClips(src.slug);
      if (clips.length === 0) {
        summary.sources.push(sourceLog);
        continue;
      }

      const ids = clips.map((c) => c.id);
      const { data: existing } = await supabaseAdmin
        .from("clips")
        .select("kick_clip_id")
        .in("kick_clip_id", ids);
      const seen = new Set((existing ?? []).map((r) => r.kick_clip_id));
      const fresh = clips.filter(
        (c) =>
          !seen.has(c.id) &&
          !blocked.some((kw) =>
            kw && c.title.toLowerCase().includes(kw.toLowerCase()),
          ),
      );

      for (const clip of fresh.slice(0, 10)) {
        const score = await scoreClip(clip, apiKey);
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
          status: "pending",
          stream_timestamp: clip.createdAt,
        });
        if (insErr) {
          console.error("[poll] insert failed", insErr);
        } else {
          sourceLog.new++;
          summary.new_clips++;
        }
      }
    } catch (err: any) {
      console.error(`[poll] source ${src.slug} failed`, err);
      sourceLog.error = err?.message ?? String(err);
    }
    summary.sources.push(sourceLog);
  }

  await supabaseAdmin
    .from("audit_log")
    .insert({ action: "poll_kick", details: summary as any });

  return summary;
}
