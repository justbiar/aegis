import { NextResponse } from "next/server";
import { scanRepoPullRequests, maskRepo } from "@/lib/scan";
import { fetchRegistry } from "@/lib/registry";
import { nextPrBatch, discoveryAvailable } from "@/lib/discovery";
import { recordEpoch } from "@/lib/epochs";

export const maxDuration = 120;

// Scans open pull requests for committed secrets.
//
// Unlike the file sweep, this spends the core API quota — one call per repo,
// 5000/hr with a token — so it works through a small slice each run. The
// sprint registry is always included because those projects opted in and are
// the ones a rescue can actually help; the rest of the slice rotates through
// the discovered set on its own cursor.
//
// Rescue is limited to testnet here, matching the ecosystem sweep, and every
// flagged repo name is masked before it is stored or returned.

const CONCURRENCY = 4;
const DISCOVERED_PER_RUN = 60;
const MAX_PRS_PER_REPO = 10;

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const extra = Math.min(200, Math.max(0, Number(params.get("batch") ?? DISCOVERED_PER_RUN)));
    const startedAt = Date.now();

    const registry = await fetchRegistry().catch(() => []);
    const registryUrls = registry.map((e) => e.repo_url);

    let discovered: string[] = [];
    let offset = 0;
    let total = 0;
    if (discoveryAvailable && extra > 0) {
      const batch = await nextPrBatch(extra);
      discovered = batch.repos;
      offset = batch.offset;
      total = batch.total;
    }

    // Registry first, then the rotating slice, minus anything already covered.
    const seen = new Set(registryUrls);
    const targets = [...registryUrls, ...discovered.filter((u) => !seen.has(u))];

    const results: Awaited<ReturnType<typeof scanRepoPullRequests>>[] = [];
    let cursor = 0;
    let rateLimited = false;
    async function worker() {
      while (cursor < targets.length) {
        if (rateLimited) return; // stop spending calls once GitHub says no
        const url = targets[cursor++];
        const r = await scanRepoPullRequests(url, MAX_PRS_PER_REPO, { rescueNetworks: ["sepolia"] });
        if (r.rateLimited) rateLimited = true;
        results.push(r);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    let prsChecked = 0;
    let exposures = 0;
    let errors = 0;
    const flagged: { repo: string; kind: "exposure" | "rescue" }[] = [];
    for (const r of results) {
      prsChecked += r.prsChecked;
      if (r.status === "error") errors++;
      else if (r.status === "leak") {
        exposures++;
        flagged.push({ repo: maskRepo(r.repoUrl.replace("https://github.com/", "")), kind: "exposure" });
      }
    }

    await recordEpoch({
      ts: Date.now(),
      durationMs: Date.now() - startedAt,
      source: "prs",
      scanned: results.length,
      clean: results.length - exposures - errors,
      exposures,
      rescued: 0,
      rescuedStrk: 0,
      errors,
      flagged,
    });

    return NextResponse.json({
      reposScanned: results.length,
      prsChecked,
      exposures,
      errors,
      rateLimited,
      offset,
      total,
      durationMs: Date.now() - startedAt,
      // Masked for the same reason the epoch is: this response is public.
      findings: results
        .filter((r) => r.status === "leak" || r.status === "info")
        .map((r) => ({
          ...r,
          repoUrl: maskRepo(r.repoUrl.replace("https://github.com/", "")),
          pullRequests: r.pullRequests.map((p) => ({ ...p, headRepo: maskRepo(p.headRepo), author: maskRepo(p.author) })),
        })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "PR scan failed" }, { status: 502 });
  }
}
