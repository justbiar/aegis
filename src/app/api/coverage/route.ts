import { NextResponse } from "next/server";
import { fetchRegistry } from "@/lib/registry";
import { discoveredCount, sampleDiscovered, discoveryAvailable } from "@/lib/discovery";

export const maxDuration = 30;

// What the agent actually watches, for the live console.
//
// The console used to read /api/registry alone and so reported 140 repos —
// the sprint registry — while the ecosystem sweep was quietly covering
// thousands more. This reports both counts so the number on screen matches
// what is really being scanned.
//
// Only a sample of the discovered repos is returned: the console needs enough
// names to render nodes and a terminal readout, not the whole watch list, and
// shipping thousands of names to every visitor would be wasteful. Which repos
// are watched is not itself sensitive (they are public repos, findable by the
// same search that discovered them) — what stays masked is which ones were
// flagged, and that lives in the epoch feed.
const SAMPLE = 220;

export async function GET() {
  const registry = await fetchRegistry().catch(() => []);
  const registryUrls = registry.map((e) => e.repo_url);

  let discovered = 0;
  let sample: string[] = [];
  if (discoveryAvailable) {
    discovered = await discoveredCount().catch(() => 0);
    sample = await sampleDiscovered(SAMPLE).catch(() => []);
  }

  return NextResponse.json({
    registry: registryUrls.length,
    discovered,
    watched: registryUrls.length + discovered,
    sample,
  });
}
