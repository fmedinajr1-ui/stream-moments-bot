import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sampleKickChat } from "@/lib/kick-ws.server";
import { createSpikeClip } from "@/lib/spike-clip.server";
import { enqueueObsSave } from "@/lib/obs-trigger.server";

export type ChatPulseSummary = {
  polled: number;
  spikes: number;
  triggered: number;
  skippedCooldown: number;
  sources: Array<{
    slug: string;
    msgs_per_sec: number;
    baseline: number;
    spike_ratio: number;
    spike: boolean;
    triggered?: boolean;
    skipped_reason?: string;
    sampled_ms?: number;
    msg_count?: number;
    error?: string;
  }>;
};

const BASELINE_MIN = 10;

async function resolveChatroomId(slug: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Referer: `https://kick.com/${slug}`,
        },
      },
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.chatroom?.id ?? null;
  } catch {
    return null;
  }
}

export async function runChatPulse(): Promise<ChatPulseSummary> {
  const nowIso = new Date().toISOString();

  const { data: settings } = await supabaseAdmin
    .from("agent_settings")
    .select(
      "is_paused,spike_window_sec,spike_min_mps,auto_grab_cooldown_sec,auto_grab_enabled,browser_capture_enabled,auto_mark_on_spike",
    )
    .limit(1)
    .maybeSingle();

  const windowSec = Math.max(15, Number(settings?.spike_window_sec ?? 60));
  const sampleMs = Math.min(20_000, windowSec * 1000);
  const minMps = Number(settings?.spike_min_mps ?? 0.5);
  const cooldownSec = Math.max(0, Number(settings?.auto_grab_cooldown_sec ?? 180));
  const browserCapture = settings?.browser_capture_enabled !== false;
  // Option A: when browser-capture is on, the server NEVER creates spike
  // clips — the dashboard tab does it. We still record velocity rows.
  const autoEnabled =
    !browserCapture &&
    settings?.auto_grab_enabled !== false &&
    !settings?.is_paused;

  const { data: sources, error } = await supabaseAdmin
    .from("sources")
    .select("id, slug, spike_sensitivity, last_known_live, force_live_until")
    .eq("is_monitoring", true)
    .or(`last_known_live.eq.true,force_live_until.gt.${nowIso}`);
  if (error) throw error;

  const summary: ChatPulseSummary = {
    polled: 0,
    spikes: 0,
    triggered: 0,
    skippedCooldown: 0,
    sources: [],
  };

  const results = await Promise.allSettled(
    (sources ?? []).map(async (src) => {
      const log: ChatPulseSummary["sources"][number] = {
        slug: src.slug,
        msgs_per_sec: 0,
        baseline: 0,
        spike_ratio: 0,
        spike: false,
      };

      const chatroomId = await resolveChatroomId(src.slug);
      if (!chatroomId) {
        log.error = "no chatroom id";
        return { src, log };
      }

      const sample = await sampleKickChat(chatroomId, sampleMs);
      const seconds = Math.max(sample.durationMs / 1000, 1);
      const mps = sample.messages.length / seconds;

      const baselineSince = new Date(
        Date.now() - BASELINE_MIN * 60 * 1000,
      ).toISOString();
      const { data: hist } = await supabaseAdmin
        .from("chat_velocity")
        .select("msgs_per_sec")
        .eq("source_id", src.id)
        .gte("created_at", baselineSince);
      const baseline =
        hist && hist.length > 0
          ? hist.reduce((a, r) => a + Number(r.msgs_per_sec), 0) / hist.length
          : Math.max(mps, 0.2);
      const ratio = baseline > 0 ? mps / baseline : 0;

      const sensitivity = Number(src.spike_sensitivity ?? 2.0);
      const isSpike = ratio >= sensitivity && mps >= minMps;

      log.msgs_per_sec = +mps.toFixed(2);
      log.baseline = +baseline.toFixed(2);
      log.spike_ratio = +ratio.toFixed(2);
      log.spike = isSpike;
      log.sampled_ms = sample.durationMs;
      log.msg_count = sample.messages.length;
      if (sample.error) log.error = sample.error;

      const sampleMessages = sample.messages
        .sort((a, b) => b.content.length - a.content.length)
        .slice(0, 5)
        .map((m) => ({ user: m.username, text: m.content.slice(0, 140) }));

      const { data: velRow } = await supabaseAdmin
        .from("chat_velocity")
        .insert({
          source_id: src.id,
          msgs_per_sec: mps,
          baseline_msgs_per_sec: baseline,
          spike_ratio: ratio,
          is_spike: isSpike,
          sample_messages: sampleMessages,
          peak_window: `${Math.round(seconds)}s`,
        })
        .select("id")
        .single();

      let triggered = false;
      let skipReason: string | undefined;

      if (isSpike && velRow) {
        // Always nudge OBS watcher (no-op if not connected).
        await enqueueObsSave({
          sourceId: src.id,
          sourceSlug: src.slug,
          reason: "chat_spike",
          payload: { spike_ratio: ratio, msgs_per_sec: mps, velocity_id: velRow.id },
        });
      }

      if (isSpike && velRow && autoEnabled) {
        // Per-source cooldown — skip if we already auto-grabbed within window.
        const cooldownSince = new Date(Date.now() - cooldownSec * 1000).toISOString();
        const { data: recent } = await supabaseAdmin
          .from("clips")
          .select("id,created_at")
          .eq("source_id", src.id)
          .eq("auto_grabbed", true)
          .gte("created_at", cooldownSince)
          .limit(1);

        if (recent && recent.length > 0) {
          skipReason = `cooldown (${cooldownSec}s)`;
          await supabaseAdmin.from("audit_log").insert({
            action: "spike_grab_skipped",
            details: {
              source_id: src.id,
              slug: src.slug,
              spike_ratio: ratio,
              msgs_per_sec: mps,
              reason: skipReason,
              last_clip_id: recent[0].id,
              last_clip_at: recent[0].created_at,
            },
          });
        } else {
          try {
            const clipRes = await createSpikeClip({
              sourceId: src.id,
              slug: src.slug,
              matchedVelocityId: velRow.id,
              spikeRatio: ratio,
              msgsPerSec: mps,
              sampleMessages,
              autoGrabbed: true,
            });
            triggered = !!clipRes.ok;
            await supabaseAdmin.from("audit_log").insert({
              action: triggered ? "spike_grab_triggered" : "spike_grab_failed",
              clip_id: triggered ? clipRes.clipId : null,
              details: {
                source_id: src.id,
                slug: src.slug,
                spike_ratio: ratio,
                msgs_per_sec: mps,
                error: triggered ? null : clipRes.error,
              },
            });
            console.log(
              `[chat-pulse] auto-grab ${src.slug}:`,
              JSON.stringify(clipRes),
            );
          } catch (err: any) {
            await supabaseAdmin.from("audit_log").insert({
              action: "spike_grab_failed",
              details: {
                source_id: src.id,
                slug: src.slug,
                spike_ratio: ratio,
                msgs_per_sec: mps,
                error: err?.message ?? String(err),
              },
            });
            console.error(`[chat-pulse] auto-grab threw ${src.slug}`, err);
          }
        }
      }

      log.triggered = triggered;
      log.skipped_reason = skipReason;

      return { src, log, isSpike, triggered, skipReason };
    }),
  );

  for (const r of results) {
    summary.polled++;
    if (r.status === "fulfilled") {
      summary.sources.push(r.value.log);
      if (r.value.isSpike) summary.spikes++;
      if (r.value.triggered) summary.triggered++;
      if (r.value.skipReason) summary.skippedCooldown++;
    } else {
      summary.sources.push({
        slug: "?",
        msgs_per_sec: 0,
        baseline: 0,
        spike_ratio: 0,
        spike: false,
        error: String(r.reason),
      });
    }
  }

  // Single audit row capturing the whole tick (handy in the timeline).
  await supabaseAdmin.from("audit_log").insert({
    action: "chat_pulse_tick",
    details: summary as any,
  });

  return summary;
}
