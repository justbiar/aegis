import { NextResponse } from "next/server";
import { discoverStarknetRepos, discoveredCount, discoveryAvailable } from "@/lib/discovery";

export const maxDuration = 60;

// Builds the watch list of Starknet repos. Read-only against GitHub search and
// writes only repo URLs to KV — it never scans or touches funds. Meant to be
// pinged on a slow schedule (hourly is plenty); each call walks a few search
// pages and continues from where the last one stopped.
export async function GET(req: Request) {
  if (!discoveryAvailable) {
    return NextResponse.json({ error: "KV is not configured" }, { status: 503 });
  }
  const pages = Math.min(10, Math.max(1, Number(new URL(req.url).searchParams.get("pages") ?? 6)));
  const run = await discoverStarknetRepos(pages);
  return NextResponse.json({ run, total: run?.total ?? (await discoveredCount()) });
}
