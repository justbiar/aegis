import { NextRequest, NextResponse } from "next/server";

// Server-side RPC proxy. The browser (wallet panel, registration check,
// waitForTransaction) talks to /api/rpc/<network> instead of straight to
// Alchemy, so the Alchemy key never ships in the client bundle — only this
// route, running on the server, holds it. Prefer a non-public PROVIDER_URL;
// fall back to the legacy NEXT_PUBLIC_PROVIDER_URL so nothing breaks before the
// env is renamed (it's only read here, server-side, so it isn't exposed).
const KEY = process.env.PROVIDER_URL ?? process.env.NEXT_PUBLIC_PROVIDER_URL;

const UPSTREAM: Record<string, string> = {
  mainnet: "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/",
  sepolia: "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/",
};

// Cap request size and only forward genuine Starknet JSON-RPC calls, so the
// proxy can't be turned into an open relay to arbitrary methods.
const MAX_BODY = 1_000_000; // 1 MB

function isStarknetRpc(payload: any): boolean {
  const ok = (m: unknown) => typeof m === "string" && m.startsWith("starknet_");
  if (Array.isArray(payload)) return payload.length > 0 && payload.every((p) => ok(p?.method));
  return ok(payload?.method);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ network: string }> }) {
  const { network } = await ctx.params;
  const base = UPSTREAM[network];
  if (!base) return NextResponse.json({ error: "Unknown network" }, { status: 404 });
  if (!KEY) return NextResponse.json({ error: "RPC not configured" }, { status: 500 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isStarknetRpc(payload)) {
    return NextResponse.json({ error: "Only starknet_* JSON-RPC methods are allowed" }, { status: 400 });
  }

  try {
    const upstream = await fetch(base + KEY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Upstream RPC error: ${err?.message ?? "unknown"}` }, { status: 502 });
  }
}
