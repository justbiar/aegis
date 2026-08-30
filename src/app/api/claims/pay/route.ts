import { NextRequest, NextResponse } from "next/server";
import { RpcProvider } from "starknet";
import { auth } from "@/auth";
import { RPC_URL, SAFE_WALLET, type Network } from "@/lib/networks";
import { markClaimsPaid, type ClaimRef } from "@/lib/claims";

// GitHub login allowed to mark claims paid — the safe-wallet operator. Same
// default as the client-side admin gate.
const ADMIN_LOGIN = (process.env.NEXT_PUBLIC_ADMIN_GITHUB_LOGIN ?? "justbiar").toLowerCase();

// Accepts either a batch ({ claims: [...] }) or a single claim spelled out at
// the top level, which is how this endpoint was first called.
function parseEntries(body: any): (ClaimRef & { net?: number })[] {
  const raw = Array.isArray(body?.claims) ? body.claims : [body];
  return raw.flatMap((r: any) => {
    const repoUrl = typeof r?.repoUrl === "string" ? r.repoUrl : null;
    const network = r?.network as Network | undefined;
    if (!repoUrl || (network !== "mainnet" && network !== "sepolia")) return [];
    return [{
      repoUrl,
      network,
      requestedAt: typeof r?.requestedAt === "number" ? r.requestedAt : undefined,
      net: typeof r?.net === "number" ? r.net : undefined,
    }];
  });
}

// STRK20 privacy pool per network — used only to confirm the tx actually
// touched the pool (a real payout), not just any successful tx.
const POOL: Record<Network, string> = {
  mainnet: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  sepolia: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
};

function sameFelt(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

// Marks a claim paid after a private STRK20 transfer has gone out. A private
// transfer emits only an encrypted note + nullifier — there's no public
// from/to/amount to verify, and (crucially) the on-chain sender_address is a
// pool-internal account, NOT the safe wallet, so we can't prove the safe wallet
// sent it or tie the tx to a specific claim. What we CAN enforce:
//   1. Only the authenticated operator (admin GitHub login) may call this — so
//      an anonymous caller can't flip arbitrary claims to "paid".
//   2. The tx is real, SUCCEEDED, and actually interacted with the pool
//      contract — so a random unrelated tx hash won't be accepted.
// No money moves through this endpoint; it's bookkeeping. These checks keep
// that bookkeeping from being forged by anyone but the trusted operator.
export async function POST(req: NextRequest) {
  const session = await auth();
  const login = ((session?.user as any)?.login as string | undefined)?.toLowerCase();
  if (!login || login !== ADMIN_LOGIN) {
    return NextResponse.json({ error: "Only the Aegis operator can mark claims paid" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const txHash = body?.txHash as string | undefined;
  // One transaction settles a whole batch, so this takes the batch. Sending a
  // request per claim instead had them race: each rewrites the entire claim
  // list from its own snapshot, so a claim that was just marked paid could be
  // written back as pending and then get paid all over again.
  const entries = parseEntries(body);
  const network = entries[0]?.network;
  if (!txHash || entries.length === 0 || !network) {
    return NextResponse.json({ error: "txHash and at least one claim are required" }, { status: 400 });
  }
  if (entries.some((e) => e.network !== network)) {
    return NextResponse.json({ error: "Every claim in one payout must be on the same network" }, { status: 400 });
  }

  const safeAddress = SAFE_WALLET[network];
  if (!safeAddress) {
    return NextResponse.json({ error: "No safe wallet configured for this network" }, { status: 403 });
  }

  const rpc = RPC_URL[network];
  if (!rpc) return NextResponse.json({ error: "RPC not configured for this network" }, { status: 500 });

  try {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const receipt: any = await provider.getTransactionReceipt(txHash);
    const status = receipt?.execution_status ?? receipt?.value?.execution_status;
    if (status !== "SUCCEEDED") {
      return NextResponse.json({ error: `Transaction status is ${status ?? "unknown"}, not SUCCEEDED` }, { status: 400 });
    }
    // Confirm the tx actually touched the privacy pool — a real payout emits
    // events from the pool contract. Rejects unrelated successful txs.
    const events: any[] = receipt?.events ?? receipt?.value?.events ?? [];
    const touchedPool = events.some((e) => sameFelt(e?.from_address, POOL[network]));
    if (!touchedPool) {
      return NextResponse.json({ error: "Transaction didn't interact with the STRK20 pool" }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: `Could not look up transaction: ${err?.message ?? "unknown error"}` }, { status: 400 });
  }

  const missed = await markClaimsPaid(entries, txHash, true);
  if (missed.length === entries.length) {
    return NextResponse.json({ error: "No matching pending claim found" }, { status: 404 });
  }
  // A partial miss still means money moved for the rest, so this isn't an
  // error — but the operator has to see which records didn't settle.
  return NextResponse.json({ ok: true, settled: entries.length - missed.length, missed });
}
