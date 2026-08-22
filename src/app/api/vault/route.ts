import { NextResponse } from "next/server";
import { rpcBalanceOf } from "@/lib/scan";
import { SAFE_WALLET, RPC_URL, STRK_TOKEN, type Network } from "@/lib/networks";
import { getLedger, ledgerAvailable } from "@/lib/ledger";
import { getClaims } from "@/lib/claims";

interface NetworkVaultInfo {
  address: string | null;
  balance: number | null;
  rescuedTotal: number;
  rescuedCount: number;
  // How much verified owners have requested back that hasn't been paid out yet
  // (sum of pending claim amounts on this network) and how many such claims.
  requestedTotal: number;
  requestedCount: number;
}

async function vaultInfo(
  network: Network,
  ledger: Awaited<ReturnType<typeof getLedger>>,
  claims: Awaited<ReturnType<typeof getClaims>>
): Promise<NetworkVaultInfo> {
  const address = SAFE_WALLET[network];
  const records = ledger.filter((r) => r.network === network);
  const rescuedTotal = records.reduce((sum, r) => sum + r.amount, 0);
  const rescuedCount = records.length;

  const pending = claims.filter((c) => c.network === network && c.status === "pending");
  const requestedTotal = pending.reduce((sum, c) => sum + c.amount, 0);
  const requestedCount = pending.length;

  const base = { address, rescuedTotal, rescuedCount, requestedTotal, requestedCount };
  if (!address || !RPC_URL[network]) {
    return { ...base, balance: null };
  }
  try {
    const balance = await rpcBalanceOf(STRK_TOKEN, address, network);
    return { ...base, balance: Number(balance) / 1e18 };
  } catch {
    return { ...base, balance: null };
  }
}

export async function GET() {
  const [ledger, claims] = await Promise.all([getLedger(), getClaims()]);
  const [mainnet, sepolia] = await Promise.all([
    vaultInfo("mainnet", ledger, claims),
    vaultInfo("sepolia", ledger, claims),
  ]);
  return NextResponse.json({ mainnet, sepolia, ledgerAvailable });
}
