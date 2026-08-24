import { NextResponse } from "next/server";
import { scanRepo, type ScanResult } from "@/lib/scan";
import { nextSweepBatch, discoveryAvailable } from "@/lib/discovery";
import { recordEpoch } from "@/lib/epochs";

export const maxDuration = 120;

// Sweeps the discovered Starknet repos a slice at a time, continuing from
// where the previous run stopped so the whole ecosystem gets covered over
// several runs rather than in one impossible pass.
//
// DETECT-ONLY, deliberately. These repos never registered for the sprint and
// never asked this agent to touch their wallets; sweeping a stranger's funds
// — even to hand them back — is a different act from doing it for a project
// that opted in. So this route reports exposures and leaves the money alone.
// The registry scan (/api/scan-registry) remains the only path that rescues.

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
      results.push(await scanRepo(url, { detectOnly: true }));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

function summarize(results: ScanResult[]) {
  let clean = 0;
  let exposures = 0;
  let errors = 0;
  const flagged: { repo: string; kind: "exposure" | "rescue" }[] = [];
  for (const r of results) {
    if (r.status === "error") errors++;
    else if (r.status === "leak") {
      exposures++;
      flagged.push({ repo: r.repoUrl.replace("https://github.com/", ""), kind: "exposure" });
    } else clean++;
  }
  return { scanned: results.length, clean, exposures, rescued: 0, rescuedStrk: 0, errors, flagged };
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
