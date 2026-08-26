import { NextResponse } from "next/server";
import { fetchRegistry } from "@/lib/registry";
import { scanRepo, maskRepo, type ScanResult } from "@/lib/scan";
import { recordEpoch } from "@/lib/epochs";
import { syncHotlist } from "@/lib/hotlist";

export const maxDuration = 120;

// Boil a full scan down to the counts the live console records per epoch.
function summarize(results: ScanResult[]) {
  let clean = 0;
  let exposures = 0;
  let rescued = 0;
  let rescuedStrk = 0;
  let errors = 0;
  // Record which repos produced a finding so the live console can mark the
  // real one rather than guessing. Strip to owner/name — no key material,
  // no addresses, and nothing the Coverage table doesn't already publish.
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
    } else {
      // clean, info (key with no impact), or not-scanned — all "nothing to do"
      clean++;
    }
  }
  return { scanned: results.length, clean, exposures, rescued, rescuedStrk, errors, flagged };
}

const CONCURRENCY = 8;

async function scanAll(repoUrls: string[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < repoUrls.length) {
      const url = repoUrls[cursor++];
      results.push(await scanRepo(url));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

export async function GET() {
  try {
    const startedAt = Date.now();
    const entries = await fetchRegistry();
    const results = await scanAll(entries.map((e) => e.repo_url));
    // Hand anything still leaking to the fast lane, which re-checks it every
    // few seconds instead of once a minute.
    await syncHotlist(results, "full");
    // Record this scan as one epoch (best-effort — never block the response).
    await recordEpoch({ ts: Date.now(), durationMs: Date.now() - startedAt, source: "registry", ...summarize(results) });
    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Scan failed" },
      { status: 502 }
    );
  }
}
