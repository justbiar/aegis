import { NextResponse } from "next/server";
import { rpcBalanceOf, STRK_SEPOLIA } from "@/lib/scan";
import { getLedger, ledgerAvailable } from "@/lib/ledger";

const SAFE_WALLET_ADDRESS = process.env.SAFE_WALLET_ADDRESS ?? null;

export async function GET() {
  if (!SAFE_WALLET_ADDRESS) {
    return NextResponse.json({ error: "SAFE_WALLET_ADDRESS not set" }, { status: 500 });
  }
  try {
    const [balance, ledger] = await Promise.all([
      rpcBalanceOf(STRK_SEPOLIA, SAFE_WALLET_ADDRESS),
      getLedger(),
    ]);
    return NextResponse.json({
      address: SAFE_WALLET_ADDRESS,
      balance: Number(balance) / 1e18,
      ledgerAvailable,
      rescuedTotal: ledger.reduce((sum, r) => sum + r.amount, 0),
      rescuedCount: ledger.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to read vault balance" }, { status: 502 });
  }
}
