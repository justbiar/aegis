import { NextRequest, NextResponse } from "next/server";
import { RpcProvider } from "starknet";
import { RPC_URL, SAFE_WALLET, type Network } from "@/lib/networks";
import { markClaimPaid } from "@/lib/claims";

// Marks a claim paid after a private STRK20 transfer has actually gone out.
// A private transfer emits only an encrypted note + nullifier (see
// docs/MAINNET-DAY-0.md) — no public "from/to/amount" event to verify
// against, which is the whole point. So this can't cryptographically tie
// the tx to the specific claim the way ledger.ts's rescue recording can;
// it only checks the tx is real, succeeded, and was sent by the configured
// safe wallet for that network. Worst case of someone forging this call is
// a claim wrongly shown as paid (a bookkeeping nuisance, not a fund-safety
// issue — no money moves through this endpoint).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const repoUrl = body?.repoUrl as string | undefined;
  const network = body?.network as Network | undefined;
  const txHash = body?.txHash as string | undefined;
  const payerAddress = body?.payerAddress as string | undefined;
  if (!repoUrl || !network || !txHash || !payerAddress) {
    return NextResponse.json({ error: "repoUrl, network, txHash and payerAddress are required" }, { status: 400 });
  }

  const safeAddress = SAFE_WALLET[network];
  if (!safeAddress || BigInt(payerAddress) !== BigInt(safeAddress)) {
    return NextResponse.json({ error: "payerAddress doesn't match the configured safe wallet for this network" }, { status: 403 });
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
  } catch (err: any) {
    return NextResponse.json({ error: `Could not look up transaction: ${err?.message ?? "unknown error"}` }, { status: 400 });
  }

  const marked = await markClaimPaid(repoUrl, network, txHash);
  if (!marked) {
    return NextResponse.json({ error: "No matching pending claim found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
