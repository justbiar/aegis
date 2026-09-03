import { NextResponse } from "next/server";
import { getLastScan } from "@/lib/lastscan";

// What the last full scan found, served from the cache the scan itself wrote.
// This is what the Coverage table reads: showing the last result costs a KV
// read, running a fresh scan to show the same thing costs a full pass over
// every watched repository.
export async function GET() {
  const last = await getLastScan();
  return NextResponse.json(last ?? { ts: 0, results: [] });
}
