import { NextResponse } from "next/server";
import { runHotScan } from "@/lib/hotScan";

// Ten seconds is plenty: the hot list is capped at 20 repos per scope and each
// one is a handful of raw reads plus four RPC calls.
export const maxDuration = 30;

// On-demand fast lane. The pass itself lives in lib/hotScan so CI can run it
// without going through the web host — see scripts/scan.ts.
export async function GET() {
  try {
    return NextResponse.json(await runHotScan());
  } catch (err: any) {
    const message = err?.message ?? "Hot scan failed";
    return NextResponse.json({ error: message }, { status: message.includes("KV") ? 503 : 502 });
  }
}
