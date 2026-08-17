import { NextResponse } from "next/server";
import { fetchRegistry } from "@/lib/registry";

export async function GET() {
  try {
    const entries = await fetchRegistry();
    return NextResponse.json({ entries });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load registry" },
      { status: 502 }
    );
  }
}
