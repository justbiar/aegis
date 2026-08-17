import { NextResponse } from "next/server";
import { fetchRegistry } from "@/lib/registry";
import { scanRepo, type ScanResult } from "@/lib/scan";

export const maxDuration = 60;

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
    const entries = await fetchRegistry();
    const results = await scanAll(entries.map((e) => e.repo_url));
    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Scan failed" },
      { status: 502 }
    );
  }
}
