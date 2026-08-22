import { NextResponse } from "next/server";
import { fetchRegistry } from "@/lib/registry";
import { scanRepo, type ScanResult } from "@/lib/scan";
import { recordEpoch } from "@/lib/epochs";

export const maxDuration = 120;

// Boil a full scan down to the counts the live console records per epoch.
function summarize(results: ScanResult[]) {
  let clean = 0;
  let exposures = 0;
  let rescued = 0;
  let rescuedStrk = 0;
  let errors = 0;
  for (const r of results) {
    if (r.status === "error") errors++;
    else if (r.status === "leak") {
      const swept = r.findings.filter((f) => f.rescueTxHash);
      if (swept.length > 0) {
        rescued++;
        rescuedStrk += swept.reduce((s, f) => s + (f.rescueAmount ?? 0), 0);
      } else {
        exposures++;
      }
    } else {
      // clean, info (key with no impact), or not-scanned — all "nothing to do"
      clean++;
    }
  }
  return { scanned: results.length, clean, exposures, rescued, rescuedStrk, errors };
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
    // Record this scan as one epoch (best-effort — never block the response).
    await recordEpoch({ ts: Date.now(), durationMs: Date.now() - startedAt, ...summarize(results) });
    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Scan failed" },
      { status: 502 }
    );
  }
}
