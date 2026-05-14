// Shotstack render API wrapper.
// Docs: https://shotstack.io/docs/api/

const SHOTSTACK_API_BASE = "https://api.shotstack.io/edit/v1";

export type RenderRequest = {
  sourceUrl: string;
  trimStart: number; // seconds into source
  duration: number; // seconds
  caption: string;
  callbackUrl: string;
};

export async function submitRender(req: RenderRequest): Promise<{
  ok: boolean;
  renderId?: string;
  error?: string;
}> {
  const apiKey = process.env.SHOTSTACK_API_KEY;
  if (!apiKey) return { ok: false, error: "Missing SHOTSTACK_API_KEY" };

  const safeCaption = (req.caption ?? "").slice(0, 80) || " ";

  const body = {
    timeline: {
      background: "#000000",
      tracks: [
        // Caption overlay on top, first 3s
        {
          clips: [
            {
              asset: {
                type: "title",
                text: safeCaption,
                style: "future",
                color: "#ffffff",
                size: "large",
                background: "#000000",
                position: "bottom",
              },
              start: 0,
              length: Math.min(3, req.duration),
              effect: "zoomIn",
            },
          ],
        },
        // Underlying video, trimmed + cropped to 9:16
        {
          clips: [
            {
              asset: {
                type: "video",
                src: req.sourceUrl,
                trim: req.trimStart,
                transcode: true,
                crop: { top: 0, bottom: 0, left: 0.281, right: 0.281 },
              },
              start: 0,
              length: req.duration,
              fit: "crop",
            },
          ],
        },
      ],
    },
    output: {
      format: "mp4",
      resolution: "1080",
      aspectRatio: "9:16",
      fps: 30,
    },
    callback: req.callbackUrl,
  };

  try {
    const res = await fetch(`${SHOTSTACK_API_BASE}/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      return {
        ok: false,
        error: json?.message ?? `Shotstack ${res.status}`,
      };
    }
    return { ok: true, renderId: json.response?.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function getRender(renderId: string): Promise<{
  status: string;
  url: string | null;
  error: string | null;
}> {
  const apiKey = process.env.SHOTSTACK_API_KEY!;
  const res = await fetch(`${SHOTSTACK_API_BASE}/render/${renderId}`, {
    headers: { "x-api-key": apiKey },
  });
  const json: any = await res.json().catch(() => ({}));
  const r = json?.response ?? {};
  return {
    status: r.status ?? "unknown",
    url: r.url ?? null,
    error: r.error ?? null,
  };
}
