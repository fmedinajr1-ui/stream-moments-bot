// HMAC helpers using Web Crypto (Worker-safe). Server-only.
async function hmacHex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signUploadToken(sourceId: string, ttlMs = 5 * 60_000) {
  const exp = Date.now() + ttlMs;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sig = await hmacHex(key, `${sourceId}.${exp}`);
  return `${sourceId}.${exp}.${sig}`;
}

export async function verifyUploadToken(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [sourceId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!exp || exp < Date.now()) return null;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const expected = await hmacHex(key, `${sourceId}.${exp}`);
  if (expected !== sig) return null;
  return sourceId;
}
