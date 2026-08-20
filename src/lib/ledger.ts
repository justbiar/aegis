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

import type { Network } from "./networks";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const LEDGER_KEY = "aegis:rescues";

export interface RescueRecord {
  amount: number;
  txHash: string;
  repoUrl: string;
  network: Network;
  timestamp: number;
}

export const ledgerAvailable = Boolean(KV_URL && KV_TOKEN);

// One real rescue happened before this ledger existed, so it was never
// logged. Found by replaying Transfer events *from* the leaked test
// account specifically (test-leak.env) — cheap and exact, unlike scanning
// the whole STRK contract's history. Verified against the actual tx.
const SEEDED_RECORDS: RescueRecord[] = [
  {
    amount: 84.87346099247694,
    txHash: "0x672742d0cf63167ba4f87017d6e2852a403ddcc060ff8d297988e9ccc5e6e1d",
    repoUrl: "https://github.com/justbiar/aegis",
    network: "sepolia",
    timestamp: 1787162397000,
  },
];

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
  if (!KV_URL || !KV_TOKEN) return SEEDED_RECORDS;
  try {
    const res = await fetch(`${KV_URL}/lrange/${LEDGER_KEY}/0/-1`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    const raw: string[] = data.result ?? [];
    // Records written before network-splitting existed have no `network`
    // field — they all predate mainnet support, so they were Sepolia.
    return [
      ...SEEDED_RECORDS,
      ...raw.map((s) => {
        const record = JSON.parse(s) as RescueRecord;
        return record.network ? record : { ...record, network: "sepolia" as const };
      }),
    ];
  } catch {
    return SEEDED_RECORDS;
  }
}
