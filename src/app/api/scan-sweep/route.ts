import { NextResponse } from "next/server";
import { scanRepo, maskRepo, type ScanResult } from "@/lib/scan";
import { nextSweepBatch, discoveryAvailable } from "@/lib/discovery";
import { recordEpoch } from "@/lib/epochs";

export const maxDuration = 120;

// Sweeps the discovered Starknet repos a slice at a time, continuing from
// where the previous run stopped so the whole ecosystem gets covered over
// several runs rather than in one impossible pass.
//
// Rescue is enabled here but restricted to testnet for now. A key published
// on GitHub is drained by scrapers within minutes, so waiting for its owner to
// opt in mostly means letting an attacker have it — the case for sweeping
// does not really depend on whether the owner registered for the sprint.
// Starting on Sepolia exercises the identical detection and sweep path
// without taking custody of strangers' mainnet funds while this is new.
//
// Flagged repo names are masked before anything is recorded: the same key is
// exposed on both chains, so naming a repo we have flagged but not yet swept
// points an attacker straight at live funds.

const CONCURRENCY = 8;
// Measured at ~92ms/repo, so this fits comfortably inside the time budget
// while leaving room for slow repos.
const BATCH = 600;

async function scanAll(repoUrls: string[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < repoUrls.length) {
      const url = repoUrls[cursor++];
      results.push(await scanRepo(url, { rescueNetworks: ["sepolia"] }));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

function summarize(results: ScanResult[]) {
  let clean = 0;
  let exposures = 0;
  let errors = 0;
  let rescued = 0;
  let rescuedStrk = 0;
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

export async function GET(req: Request) {
  if (!discoveryAvailable) {
    return NextResponse.json({ error: "KV is not configured" }, { status: 503 });
  }
  try {
    const size = Math.min(BATCH, Math.max(1, Number(new URL(req.url).searchParams.get("batch") ?? BATCH)));
    const startedAt = Date.now();
    const { repos, offset, total } = await nextSweepBatch(size);
    if (repos.length === 0) {
      return NextResponse.json({ scanned: 0, total, note: "Nothing discovered yet — run /api/discover first" });
    }
    const results = await scanAll(repos);
    const summary = summarize(results);
    await recordEpoch({ ts: Date.now(), durationMs: Date.now() - startedAt, source: "sweep", ...summary });
    return NextResponse.json({ ...summary, offset, total, durationMs: Date.now() - startedAt });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Sweep failed" }, { status: 502 });
  }
}
