// Long-polls /api/public/obs-trigger-poll. When the app pushes a save_replay
// command (chat spike or MARK MOMENT), forwards it to OBS via obs-websocket.
//
// Usage:  node trigger.mjs   (uses ./config.json)
//
// Requires Node 18+ (uses built-in WebSocket).

import fs from "node:fs";
import crypto from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const CONFIG_PATH = process.env.CONFIG ?? "./config.json";
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

// ---- Minimal obs-websocket v5 client ---------------------------------------

class ObsClient {
  constructor(url, password) {
    this.url = url;
    this.password = password;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.identified = false;
  }
  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener("message", (ev) => this.onMessage(ev, resolve, reject));
      ws.addEventListener("error", (ev) => reject(new Error(`obs ws error: ${ev?.message ?? "unknown"}`)));
      ws.addEventListener("close", () => {
        this.identified = false;
        console.log("[trigger] obs disconnected");
      });
    });
  }
  onMessage(ev, resolveConnect, rejectConnect) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    // Hello (op 0)
    if (msg.op === 0) {
      const auth = msg.d.authentication;
      let authString;
      if (auth) {
        const secret = crypto
          .createHash("sha256")
          .update(this.password + auth.salt)
          .digest("base64");
        authString = crypto
          .createHash("sha256")
          .update(secret + auth.challenge)
          .digest("base64");
      }
      this.ws.send(JSON.stringify({
        op: 1,
        d: { rpcVersion: 1, authentication: authString, eventSubscriptions: 0 },
      }));
    }
    // Identified (op 2)
    if (msg.op === 2) {
      this.identified = true;
      console.log("[trigger] obs identified");
      resolveConnect();
    }
    // RequestResponse (op 7)
    if (msg.op === 7) {
      const p = this.pending.get(msg.d.requestId);
      if (p) {
        this.pending.delete(msg.d.requestId);
        if (msg.d.requestStatus?.result) p.resolve(msg.d.responseData ?? {});
        else p.reject(new Error(msg.d.requestStatus?.comment ?? "obs request failed"));
      }
    }
  }
  request(requestType, requestData = {}) {
    if (!this.identified) return Promise.reject(new Error("not identified"));
    const requestId = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify({
        op: 6,
        d: { requestType, requestId, requestData },
      }));
    });
  }
  isOpen() {
    return this.ws && this.ws.readyState === 1 && this.identified;
  }
}

// ---- Polling loop ----------------------------------------------------------

let obs = null;
async function ensureObs() {
  if (obs && obs.isOpen()) return obs;
  obs = new ObsClient(cfg.obsWebSocket.url, cfg.obsWebSocket.password ?? "");
  await obs.connect();
  return obs;
}

async function saveReplay() {
  const c = await ensureObs();
  await c.request("SaveReplayBuffer");
  console.log("[trigger] SaveReplayBuffer sent");
}

async function pollOnce() {
  const url = `${cfg.appUrl}/api/public/obs-trigger-poll?sourceSlug=${encodeURIComponent(cfg.sourceSlug)}`;
  const res = await fetch(url, { headers: { "x-obs-secret": cfg.uploadSecret } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.command) {
    console.log(`[trigger] command:`, body.command);
    if (body.command.action === "save_replay") {
      try { await saveReplay(); }
      catch (err) { console.error("[trigger] save failed:", err.message); }
    }
  }
}

console.log(`[trigger] polling ${cfg.appUrl} for "${cfg.sourceSlug}"`);
while (true) {
  try { await pollOnce(); }
  catch (err) {
    console.error("[trigger] poll error:", err.message);
    await sleep(3000);
  }
}
