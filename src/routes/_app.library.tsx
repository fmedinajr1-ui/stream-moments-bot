import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { listApprovedClips, recordDownload } from "@/lib/clips.functions";
import { retryRender, regrabClip } from "@/lib/render.functions";

export const Route = createFileRoute("/_app/library")({
  component: LibraryPage,
});

type RenderJob = {
  id: string;
  status: "pending" | "rendering" | "done" | "failed";
  output_url: string | null;
  error_message: string | null;
  created_at: string;
};

type Clip = {
  id: string;
  title: string | null;
  hook_caption: string | null;
  virality_score: number | null;
  thumbnail_url: string | null;
  video_url: string | null;
  rendered_video_url: string | null;
  kick_clip_url: string | null;
  duration_seconds: number | null;
  approved_at: string | null;
  stream_timestamp: string | null;
  score_breakdown: any;
  sources: { display_name: string; slug: string } | null;
  render_jobs: RenderJob[] | null;
};

function latestJob(c: Clip): RenderJob | null {
  const list = c.render_jobs ?? [];
  if (!list.length) return null;
  return [...list].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
}

function LibraryPage() {
  const fetchClips = useServerFn(listApprovedClips);
  const record = useServerFn(recordDownload);
  const retryFn = useServerFn(retryRender);
  const { data, refetch } = useQuery({
    queryKey: ["approved-clips"],
    queryFn: () => fetchClips(),
    refetchInterval: 15_000,
  });
  const clips: Clip[] = (data?.clips ?? []) as any;

  const retryMut = useMutation({
    mutationFn: (clipId: string) => retryFn({ data: { clipId } }),
    onSuccess: (res: any) => {
      if (res?.ok) toast.success("Render queued");
      else toast.error(res?.error ?? "Render failed to queue");
      refetch();
    },
    onError: (err: any) => toast.error(err?.message ?? "Retry failed"),
  });

  function downloadMp4(c: Clip) {
    const job = latestJob(c);
    const url = c.rendered_video_url ?? job?.output_url ?? c.video_url;
    if (!url) {
      toast.error("No MP4 available yet — render still in progress");
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(c.hook_caption ?? c.title ?? "clip")
      .replace(/[^a-z0-9-_ ]/gi, "")
      .slice(0, 60)}.mp4`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    record({ data: { clip_id: c.id, format: "mp4" } });
    toast.success("MP4 download started");
  }

  function copyMetadata(c: Clip) {
    const meta = {
      id: c.id,
      title: c.title,
      hook_caption: c.hook_caption,
      virality_score: c.virality_score,
      score_breakdown: c.score_breakdown,
      duration_seconds: c.duration_seconds,
      streamer: c.sources?.display_name,
      kick_clip_url: c.kick_clip_url,
      video_url: c.video_url,
      stream_timestamp: c.stream_timestamp,
      approved_at: c.approved_at,
    };
    navigator.clipboard.writeText(JSON.stringify(meta, null, 2));
    record({ data: { clip_id: c.id, format: "metadata" } });
    toast.success("metadata.json copied");
  }

  function copyCapcut(c: Clip) {
    const manifest = {
      version: "1.0",
      tracks: [
        {
          type: "video",
          clips: [
            {
              source: c.video_url,
              start: 0,
              duration: c.duration_seconds ?? 0,
            },
          ],
        },
        {
          type: "caption",
          clips: [
            {
              text: c.hook_caption ?? c.title ?? "",
              start: 0,
              duration: Math.min(3, c.duration_seconds ?? 3),
              style: "BOLD_CAPS_TOP",
            },
          ],
        },
      ],
    };
    navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
    record({ data: { clip_id: c.id, format: "capcut" } });
    toast.success("CapCut manifest copied");
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-blood/40 pb-4">
        <h2 className="font-display text-2xl sm:text-3xl md:text-4xl tracking-wider">LIBRARY</h2>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-widest">
          {clips.length} APPROVED CLIPS — DOWNLOAD MP4, METADATA, OR CAPCUT
          MANIFEST
        </p>
      </div>

      {clips.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <h3 className="font-display text-3xl sm:text-4xl md:text-5xl text-foreground tracking-widest">
            NOTHING APPROVED YET
          </h3>
          <p className="mt-4 text-xs font-mono text-muted-foreground tracking-widest max-w-md">
            APPROVE CLIPS IN THE QUEUE — THEY LAND HERE READY TO DOWNLOAD.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {clips.map((c) => {
            const job = latestJob(c);
            const renderState = c.rendered_video_url
              ? "ready"
              : (job?.status ?? "pending");
            const badgeColor =
              renderState === "ready" || renderState === "done"
                ? "bg-green-700 text-white"
                : renderState === "failed"
                ? "bg-blood text-blood-foreground"
                : "bg-gold text-black";
            const badgeText =
              renderState === "ready" || renderState === "done"
                ? "✓ RENDERED"
                : renderState === "rendering"
                ? "RENDERING…"
                : renderState === "failed"
                ? "FAILED"
                : "QUEUED";
            return (
              <article
                key={c.id}
                className="bg-panel border border-blood/40 scanlines flex flex-col"
              >
                <div className="relative aspect-video bg-black overflow-hidden">
                  {c.thumbnail_url ? (
                    <img
                      src={c.thumbnail_url}
                      alt={c.hook_caption ?? "clip"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-display text-4xl text-blood/40">
                      NO THUMB
                    </div>
                  )}
                  <div className="absolute top-2 right-2 bg-blood text-blood-foreground font-mono text-xs px-2 py-0.5">
                    {c.virality_score ?? 0}
                  </div>
                  <div
                    className={`absolute top-2 left-2 font-mono text-[10px] tracking-widest px-1.5 py-0.5 ${badgeColor}`}
                  >
                    {badgeText}
                  </div>
                  <div className="absolute bottom-2 left-2 font-mono text-[10px] text-muted-foreground bg-black/70 px-1.5 py-0.5">
                    {c.duration_seconds ?? 0}s
                  </div>
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <div className="text-[10px] font-mono text-muted-foreground tracking-widest">
                    @{c.sources?.slug ?? "kick"} •{" "}
                    {c.approved_at
                      ? new Date(c.approved_at).toLocaleDateString()
                      : ""}
                  </div>
                  <h3 className="font-display text-lg text-foreground tracking-wide mt-1 line-clamp-2">
                    {c.hook_caption ?? c.title ?? "UNTITLED"}
                  </h3>
                  {renderState === "failed" && job?.error_message && (
                    <p className="mt-2 text-[10px] font-mono text-blood/80 line-clamp-2">
                      {job.error_message}
                    </p>
                  )}
                  <div className="mt-auto pt-4 grid grid-cols-3 gap-2">
                    {renderState === "failed" ? (
                      <button
                        onClick={() => retryMut.mutate(c.id)}
                        disabled={retryMut.isPending}
                        className="text-[10px] font-mono tracking-widest bg-blood text-blood-foreground py-2 hover:shadow-glow-red disabled:opacity-50"
                      >
                        RETRY
                      </button>
                    ) : (
                      <button
                        onClick={() => downloadMp4(c)}
                        disabled={renderState !== "ready" && renderState !== "done"}
                        className="text-[10px] font-mono tracking-widest bg-blood text-blood-foreground py-2 hover:shadow-glow-red disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        MP4
                      </button>
                    )}
                    <button
                      onClick={() => copyMetadata(c)}
                      className="text-[10px] font-mono tracking-widest border border-blood/60 text-foreground py-2 hover:bg-blood/10"
                    >
                      META
                    </button>
                    <button
                      onClick={() => copyCapcut(c)}
                      className="text-[10px] font-mono tracking-widest border border-blood/60 text-foreground py-2 hover:bg-blood/10"
                    >
                      CAPCUT
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
