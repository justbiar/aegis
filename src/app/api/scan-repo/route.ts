import { NextResponse } from "next/server";
import { scanRepo } from "@/lib/scan";
import { enqueueRepo } from "@/lib/discovery";

export const maxDuration = 60;

// Public "scan my own repo" endpoint.
//
// Always detect-only: this is an unauthenticated endpoint, so a rescue here
// would mean an anonymous request could move real funds out of any address a
// leaked key happens to control. Detection is read-only and safe to expose;
// sweeping is not, and stays limited to the sprint registry scan.
//
// The scanner itself only ever fetches a fixed list of file names from
// github.com / raw.githubusercontent.com, so an attacker cannot point this at
// an internal host — but we still validate the URL before doing any work.

const GITHUB_REPO = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/?$/;

// Small in-memory limiter. Serverless instances are not shared, so this is a
// speed bump against casual hammering rather than a strict global quota — it
// costs nothing and needs no extra infrastructure.
const RATE_LIMIT = 12;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return recent.length > RATE_LIMIT;
}

function normalise(input: string): string | null {
  let url = input.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\.git$/, "").replace(/\/+$/, "");
  return GITHUB_REPO.test(url) ? url : null;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many scans — wait a minute and try again." }, { status: 429 });
  }

  let body: { repoUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const repoUrl = normalise(body.repoUrl ?? "");
  if (!repoUrl) {
    return NextResponse.json(
      { error: "Enter a public GitHub repo URL, e.g. https://github.com/owner/repo" },
      { status: 400 }
    );
  }

  try {
    const result = await scanRepo(repoUrl, { detectOnly: true });

    // A verified exposure found here still needs rescuing — it just must not
    // be this endpoint that does it. Queueing the repo hands it to the
    // scheduled sweep, which is the only path allowed to move funds, so the
    // leak gets handled without an anonymous request ever being the trigger.
    let queued = false;
    if (result.status === "leak") {
      queued = await enqueueRepo(repoUrl).catch(() => false);
    }
    return NextResponse.json({ result, queued });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Scan failed" }, { status: 502 });
  }
}
