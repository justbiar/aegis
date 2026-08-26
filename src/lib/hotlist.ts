// Repos already known to be leaking, kept so they can be re-checked far more
// often than the full scan runs.
//
// A full registry pass reads ~1200 files to answer "is anyone leaking?", and
// that question only needs asking every minute or so. But once a repo is known
// to hold an exposed key, the question changes to "is it funded yet?", and that
// one is cheap — a handful of file reads and four RPC calls. Polling the known
// set on a fast loop closes the window between someone funding a leaked wallet
// and the sweep, without multiplying the cost of discovery.
//
// The list is server-side only and is never served by any route. Which repos
// are leaking is precisely the fact the console masks, so it stays here.

import type { ScanResult } from "./scan";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Two lists, because the two populations have different rescue permissions and
// mixing them would quietly promote a swept-up repo to mainnet rescue.
// "full" is the opted-in sprint registry; "testnet" is everything the ecosystem
// sweep and the PR pass turned up.
export type HotScope = "full" | "testnet";

const KEY: Record<HotScope, string> = {
  full: "aegis:hot:full",
  testnet: "aegis:hot:testnet",
};

// A cap so a bad day — a query that suddenly flags dozens of repos — can't turn
// the fast lane into another full scan. Past this, the slow lane still covers
// them; they just aren't polled at high frequency.
const MAX_HOT = 20;

export const hotlistAvailable = Boolean(KV_URL && KV_TOKEN);

async function kv(path: string): Promise<any> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/${path}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    return await res.json();
  } catch {
    return null;
  }
}

export async function readHotlist(scope: HotScope): Promise<string[]> {
  const res = await kv(`smembers/${KEY[scope]}`);
  const repos: string[] = res?.result ?? [];
  return repos.sort();
}

// Folds a finished scan back into the hot list: anything still leaking gets
// watched closely, anything that came back clean stops being watched.
//
// Note what counts as "still leaking": a repo whose funds were swept this pass
// stays on the list. The key is still published, so the same account can be
// refunded minutes later — dropping it here is exactly how the second deposit
// would sit unnoticed until the next full pass.
export async function syncHotlist(results: ScanResult[], scope: HotScope): Promise<void> {
  if (!hotlistAvailable) return;

  const leaking = results.filter((r) => r.status === "leak").map((r) => r.repoUrl);
  const resolved = results.filter((r) => r.status === "clean" || r.status === "info").map((r) => r.repoUrl);

  // Errors are deliberately in neither list: a rate-limited or transient read
  // is not evidence that a repo stopped leaking.
  try {
    if (resolved.length > 0) {
      const args = resolved.map((u) => encodeURIComponent(u)).join("/");
      await kv(`srem/${KEY[scope]}/${args}`);
    }
    if (leaking.length > 0) {
      const current = Number((await kv(`scard/${KEY[scope]}`))?.result ?? 0);
      if (current < MAX_HOT) {
        const room = leaking.slice(0, MAX_HOT - current);
        const args = room.map((u) => encodeURIComponent(u)).join("/");
        await kv(`sadd/${KEY[scope]}/${args}`);
      }
    }
  } catch {
    // Best effort. A missing hot list only costs latency, never correctness —
    // the full scan still finds everything on its own schedule.
  }
}
