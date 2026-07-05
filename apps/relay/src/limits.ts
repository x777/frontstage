// Per-user daily rate limit backed by KV. Structural subset of the KVNamespace binding type (not
// the real @cloudflare/workers-types KVNamespace) so this stays testable with a plain in-memory
// fake in vitest — no miniflare needed.
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

// 2 days: comfortably outlives the UTC day bucket even across DST-less clock skew, so a stale key
// never lingers longer than necessary but is never evicted mid-day either.
const KEY_TTL_SECONDS = 172800;

function dayBucket(now: Date): string {
  return now.toISOString().slice(0, 10); // yyyy-mm-dd (UTC)
}

// Not atomic (get-then-put) — KV has no native increment. Acceptable for a coarse daily cap; a
// small race window under concurrent requests can let a user through slightly over the limit.
export async function checkAndCount(kv: KVLike, userId: string, limit: number): Promise<boolean> {
  const key = `u:${userId}:${dayBucket(new Date())}`;
  const current = Number((await kv.get(key)) ?? "0");
  if (current >= limit) return false;
  await kv.put(key, String(current + 1), { expirationTtl: KEY_TTL_SECONDS });
  return true;
}
