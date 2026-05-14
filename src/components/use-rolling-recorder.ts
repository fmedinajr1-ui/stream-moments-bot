import { useEffect, useRef, useState } from "react";

export type RecorderHandle = {
  ready: boolean;
  bufferedSec: number;
  /** Slice the last `durationSec` of buffered audio+video into a single Blob. */
  grab: (durationSec: number) => Promise<Blob | null>;
};

/**
 * Attach a rolling MediaRecorder to a same-origin <video> element.
 * Maintains a ring buffer of the last `bufferSec` seconds so we can
 * instantly slice "the moment" out of audio+video the user is watching.
 */
export function useRollingRecorder(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  opts: { bufferSec?: number; enabled?: boolean } = {},
): RecorderHandle {
  const bufferSec = opts.bufferSec ?? 60;
  const enabled = opts.enabled ?? true;
  const [ready, setReady] = useState(false);
  const [bufferedSec, setBufferedSec] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Array<{ blob: Blob; t: number }>>([]);
  const mimeRef = useRef<string>("video/webm");

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    if (!video) return;

    let stopped = false;
    let cleanup: (() => void) | null = null;

    const start = () => {
      if (stopped) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;

      // captureStream is non-standard but supported in Chrome/Edge/Firefox.
      const anyVideo = v as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      const cap = anyVideo.captureStream ?? anyVideo.mozCaptureStream;
      if (!cap) return;
      let stream: MediaStream;
      try {
        stream = cap.call(v);
      } catch {
        return;
      }

      const candidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      const mime =
        candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      mimeRef.current = mime || "video/webm";
      let rec: MediaRecorder;
      try {
        rec = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
      } catch (err) {
        console.warn("[rolling-recorder] MediaRecorder init failed", err);
        return;
      }
      rec.ondataavailable = (ev) => {
        if (!ev.data || ev.data.size === 0) return;
        const now = Date.now();
        chunksRef.current.push({ blob: ev.data, t: now });
        // Trim chunks older than bufferSec.
        const cutoff = now - bufferSec * 1000;
        while (chunksRef.current.length && chunksRef.current[0].t < cutoff) {
          chunksRef.current.shift();
        }
        const span =
          chunksRef.current.length > 0
            ? (now - chunksRef.current[0].t) / 1000
            : 0;
        setBufferedSec(span);
      };
      rec.onerror = (e) => console.warn("[rolling-recorder]", e);
      try {
        rec.start(1000); // 1s chunks
      } catch (err) {
        console.warn("[rolling-recorder] start failed", err);
        return;
      }
      recRef.current = rec;
      setReady(true);

      cleanup = () => {
        try {
          if (rec.state !== "inactive") rec.stop();
        } catch {
          /* noop */
        }
        stream.getTracks().forEach((t) => t.stop());
      };
    };

    if (video.readyState >= 2) start();
    const onLoaded = () => start();
    video.addEventListener("loadeddata", onLoaded);

    return () => {
      stopped = true;
      video.removeEventListener("loadeddata", onLoaded);
      if (cleanup) cleanup();
      recRef.current = null;
      chunksRef.current = [];
      setReady(false);
      setBufferedSec(0);
    };
  }, [videoRef, bufferSec, enabled]);

  const grab = async (durationSec: number): Promise<Blob | null> => {
    const rec = recRef.current;
    if (!rec) return null;
    // Force flush: requestData emits a chunk now.
    try {
      rec.requestData();
    } catch {
      /* noop */
    }
    // Give it a beat for ondataavailable.
    await new Promise((r) => setTimeout(r, 250));

    const chunks = chunksRef.current;
    if (!chunks.length) return null;
    const cutoff = Date.now() - durationSec * 1000;
    const slice = chunks.filter((c) => c.t >= cutoff).map((c) => c.blob);
    if (!slice.length) {
      // If buffer is shorter than requested, just take what we have.
      slice.push(...chunks.map((c) => c.blob));
    }
    return new Blob(slice, { type: mimeRef.current });
  };

  return { ready, bufferedSec, grab };
}
