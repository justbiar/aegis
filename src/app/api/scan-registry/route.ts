import { NextResponse } from "next/server";
import { runRegistryScan } from "@/lib/registryScan";

export const maxDuration = 120;

// Runs a full registry scan on demand. The scan itself lives in
// lib/registryScan so CI can run the same pass without going through the web
// host — see scripts/scan.ts. Nothing here is on the path of an ordinary page
// load any more: the coverage table reads the published result instead.
export async function GET() {
  try {
    return NextResponse.json({ results: await runRegistryScan() });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Scan failed" }, { status: 502 });
  }
}
