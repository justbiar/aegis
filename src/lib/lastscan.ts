// The most recent full registry scan, kept so the Coverage table can show what
// was found without running a scan of its own.
//
// The table used to scan on every page load. That was written when nothing else
// triggered one; there has been a scanning loop for a while now, so each visit
// was re-deriving an answer that already existed — ~1200 file reads, entropy
// and Stark-curve checks, on the visitor's behalf. It read as free because no
// one waits for it, but it is the single largest thing this project spends CPU
// on, and it is what exhausted the hosting plan and took the deployment
// offline. It also meant a page load could sign a rescue, which is not a
// decision a page load should be making.
//
// Same KV-or-no-op pattern as ledger.ts / epochs.ts.

import type { ScanResult } from "./scan";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = "aegis:lastscan";

export interface LastScan {
  ts: number;
  results: ScanResult[];
}

export async function saveLastScan(results: ScanResult[]): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/set/${KEY}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      body: JSON.stringify({ ts: Date.now(), results } satisfies LastScan),
    });
  } catch {
    // best-effort — a scan that can't write its cache still did the scan
  }
}

export async function getLastScan(): Promise<LastScan | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    return typeof data.result === "string" ? (JSON.parse(data.result) as LastScan) : null;
  } catch {
    return null;
  }
}
