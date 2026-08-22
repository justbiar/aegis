import { NextRequest, NextResponse } from "next/server";
import { getEpochs, epochsAvailable } from "@/lib/epochs";

// GET ?limit=120 — the most recent epochs (one per registry scan), newest last,
// for the live console. Public: it's aggregate scan telemetry, nothing private.
export async function GET(req: NextRequest) {
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "120");
  const limit = Number.isFinite(limitParam) ? limitParam : 120;
  const epochs = await getEpochs(limit);
  return NextResponse.json({ epochs, epochsAvailable });
}
