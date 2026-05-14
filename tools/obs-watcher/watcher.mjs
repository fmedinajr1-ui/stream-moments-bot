// Watches OBS replay-buffer output folder. On new file, waits for write to
// settle, then POSTs it to /api/public/obs-upload.
//
// Usage:  node watcher.mjs            (uses ./config.json)
//         CONFIG=./other.json node watcher.mjs
//
// Requires Node 18+. No npm install needed.

import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CONFIG_PATH = process.env.CONFIG ?? "./config.json";
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

const SETTLE_MS = 2500;
const POLL_MS = 1000;
const VIDEO_EXTS = new Set([".mkv", ".mp4", ".mov", ".webm", ".flv"]);

const seen = new Set();

// Seed with existing files so we don't re-upload everything on first run.
for (const name of fs.readdirSync(cfg.obsReplayDir)) {
  seen.add(name);
}
console.log(`[watcher] watching ${cfg.obsReplayDir} (${seen.size} existing files ignored)`);
console.log(`[watcher] uploading to ${cfg.appUrl}/api/public/obs-upload as "${cfg.sourceSlug}"`);

async function waitForSettle(filePath) {
  let lastSize = -1;
  for (let i = 0; i < 60; i++) {
    let size;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      return false;
    }
    if (size === lastSize && size > 0) return true;
    lastSize = size;
    await sleep(SETTLE_MS);
  }
  return false;
}

async function uploadFile(filePath, name) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf]);
  const form = new FormData();
  form.set("sourceSlug", cfg.sourceSlug);
  form.set("autoGrabbed", "false");
  form.set("reason", "obs_save");
  form.set("file", blob, name);

  const res = await fetch(`${cfg.appUrl}/api/public/obs-upload`, {
    method: "POST",
    headers: { "x-obs-secret": cfg.uploadSecret },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  console.log(`[watcher] uploaded ${name} (${buf.length} bytes) → ${text}`);
}

async function tick() {
  let entries;
  try {
    entries = fs.readdirSync(cfg.obsReplayDir);
  } catch (err) {
    console.error("[watcher] readdir failed", err.message);
    return;
  }
  for (const name of entries) {
    if (seen.has(name)) continue;
    const ext = path.extname(name).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) continue;
    seen.add(name);
    const full = path.join(cfg.obsReplayDir, name);
    console.log(`[watcher] new file: ${name}`);
    (async () => {
      try {
        const ok = await waitForSettle(full);
        if (!ok) {
          console.warn(`[watcher] never settled: ${name}`);
          return;
        }
        await uploadFile(full, name);
      } catch (err) {
        console.error(`[watcher] upload failed for ${name}:`, err.message);
      }
    })();
  }
}

while (true) {
  await tick();
  await sleep(POLL_MS);
}
