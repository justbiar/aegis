// The fast lane, as a function rather than an endpoint.
//
// Discovery is what makes a scan expensive — the registry pass reads roughly
// 1200 files to find the one repo that is leaking. Re-checking a repo already
// known to be leaking costs about a thousandth of that, so it can run many
// times a minute. This does only that: it re-scans the known-leaking repos and
// sweeps anything that has since been funded.
//
// Rescue permissions come from which list a repo is on, never from the caller,
// so a repo the ecosystem sweep found stays testnet-only here exactly as it is
// there.

import { scanRepo, maskRepo, type ScanResult } from "./scan";
import { recordEpoch } from "./epochs";
import { readHotlist, syncHotlist, hotlistAvailable } from "./hotlist";

export interface HotScanSummary {
  scanned: number;
  clean: number;
  exposures: number;
  rescued: number;
  rescuedStrk: number;
  errors: number;
  flagged: { repo: string; kind: "exposure" | "rescue" }[];
  durationMs: number;
  idle?: boolean;
}

export async function runHotScan(): Promise<HotScanSummary> {
  if (!hotlistAvailable) throw new Error("Hot list needs KV");

  const startedAt = Date.now();
  const [full, testnet] = await Promise.all([readHotlist("full"), readHotlist("testnet")]);
  if (full.length === 0 && testnet.length === 0) {
    return { scanned: 0, clean: 0, exposures: 0, rescued: 0, rescuedStrk: 0, errors: 0, flagged: [], durationMs: 0, idle: true };
  }

  const [fullResults, testnetResults] = await Promise.all([
    Promise.all(full.map((url) => scanRepo(url))),
    Promise.all(testnet.map((url) => scanRepo(url, { rescueNetworks: ["sepolia"] }))),
  ]);

  await Promise.all([
    syncHotlist(fullResults, "full"),
    syncHotlist(testnetResults, "testnet"),
  ]);

  // Only record an epoch when something actually happened. This lane runs many
  // times per hour and almost always finds the same unfunded leak sitting
  // there; writing that to the epoch feed every pass would bury the real scans
  // under identical no-op rows.
  const summary = summarize([...fullResults, ...testnetResults]);
  if (summary.rescued > 0) {
    await recordEpoch({ ts: Date.now(), durationMs: Date.now() - startedAt, source: "hot", ...summary });
  }
  return { ...summary, durationMs: Date.now() - startedAt };
}

function summarize(results: ScanResult[]) {
  let clean = 0;
  let exposures = 0;
  let rescued = 0;
  let rescuedStrk = 0;
  let errors = 0;
  const flagged: { repo: string; kind: "exposure" | "rescue" }[] = [];
  for (const r of results) {
    if (r.status === "error") errors++;
    else if (r.status === "leak") {
      const swept = r.findings.filter((f) => f.rescueTxHash);
      const repo = maskRepo(r.repoUrl.replace("https://github.com/", ""));
      if (swept.length > 0) {
        rescued++;
        rescuedStrk += swept.reduce((s, f) => s + (f.rescueAmount ?? 0), 0);
        flagged.push({ repo, kind: "rescue" });
      } else {
        exposures++;
        flagged.push({ repo, kind: "exposure" });
      }
    } else clean++;
  }
  return { scanned: results.length, clean, exposures, rescued, rescuedStrk, errors, flagged };
}
