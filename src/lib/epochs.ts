// One "epoch" = one full registry scan. Each scan-registry run records a
// compact summary here so the live console can show the agent's heartbeat over
// time (a wall of past scans, a running epoch counter, an activity feed)
// instead of only the latest in-memory result. Same KV-or-no-op pattern as
// ledger.ts / claims.ts; a missing KV must never block a scan.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const EPOCHS_KEY = "aegis:epochs";
const COUNTER_KEY = "aegis:epoch:counter";
// Keep only the most recent N epochs — the wall/feed never needs more, and it
// bounds KV growth under continuous (~90s) scanning.
const MAX_EPOCHS = 200;

export interface EpochRecord {
  n: number; // monotonic epoch number
  ts: number; // finished-at (ms)
  scanned: number; // repos scanned
  clean: number; // no key, or key with no impact
  exposures: number; // funded leak found but not rescued
  rescued: number; // accounts rescued this epoch
  rescuedStrk: number; // STRK swept this epoch
  errors: number; // repos that errored
  durationMs: number;
  // Which repos actually produced a finding this scan. Lets the live console
  // mark the real repo instead of guessing, and stays small (a scan normally
  // flags 0-1 repos). Optional: epochs recorded before this field existed
  // simply have none. Not a disclosure beyond what the site already shows —
  // the Coverage table publishes per-repo scan status on the same page.
  flagged?: { repo: string; kind: "exposure" | "rescue" }[];
}

export const epochsAvailable = Boolean(KV_URL && KV_TOKEN);

export async function recordEpoch(summary: Omit<EpochRecord, "n">): Promise<EpochRecord | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const incrRes = await fetch(`${KV_URL}/incr/${COUNTER_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const incrData = await incrRes.json();
    const n = Number(incrData.result) || 0;
    const record: EpochRecord = { n, ...summary };
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["rpush", EPOCHS_KEY, JSON.stringify(record)],
        ["ltrim", EPOCHS_KEY, -MAX_EPOCHS, -1],
      ]),
    });
    return record;
  } catch {
    return null;
  }
}

export async function getEpochs(limit = 120): Promise<EpochRecord[]> {
  if (!KV_URL || !KV_TOKEN) return [];
  const n = Math.max(1, Math.min(MAX_EPOCHS, limit));
  try {
    const res = await fetch(`${KV_URL}/lrange/${EPOCHS_KEY}/-${n}/-1`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    const raw: string[] = data.result ?? [];
    return raw.map((s) => JSON.parse(s) as EpochRecord).filter((e) => typeof e?.n === "number");
  } catch {
    return [];
  }
}
