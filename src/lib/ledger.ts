// Append-only log of real rescues, written the moment a rescue happens (the
// amount comes straight from the on-chain transfer in rescue.ts). This
// exists because the vault's balance alone isn't the same number as "total
// ever rescued" — the address can hold funds from before Aegis existed, and
// replaying full chain history via RPC to reconstruct the total is
// impractically slow (Alchemy's getEvents pages ~80k blocks per call; a
// Sepolia archive of ~13M blocks would need 150+ paginated calls). Logging
// forward as rescues happen is the only cheap, accurate source of truth.
//
// Backed by Vercel KV (Upstash Redis REST API) when configured. Silently
// becomes a no-op without it — a missing ledger must never block a rescue.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const LEDGER_KEY = "aegis:rescues";

export interface RescueRecord {
  amount: number;
  txHash: string;
  repoUrl: string;
  timestamp: number;
}

export const ledgerAvailable = Boolean(KV_URL && KV_TOKEN);

export async function recordRescue(record: RescueRecord): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/rpush/${LEDGER_KEY}/${encodeURIComponent(JSON.stringify(record))}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch {
    // best-effort — logging must never take down the rescue that already succeeded
  }
}

export async function getLedger(): Promise<RescueRecord[]> {
  if (!KV_URL || !KV_TOKEN) return [];
  try {
    const res = await fetch(`${KV_URL}/lrange/${LEDGER_KEY}/0/-1`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    const raw: string[] = data.result ?? [];
    return raw.map((s) => JSON.parse(s) as RescueRecord);
  } catch {
    return [];
  }
}
