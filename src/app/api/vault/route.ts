import { NextResponse } from "next/server";
import { rpcBalanceOf } from "@/lib/scan";
import { SAFE_WALLET, RPC_URL, STRK_TOKEN, type Network } from "@/lib/networks";
import { getLedger, ledgerAvailable } from "@/lib/ledger";

interface NetworkVaultInfo {
  address: string | null;
  balance: number | null;
  rescuedTotal: number;
  rescuedCount: number;
}

async function vaultInfo(network: Network, ledger: Awaited<ReturnType<typeof getLedger>>): Promise<NetworkVaultInfo> {
  const address = SAFE_WALLET[network];
  const records = ledger.filter((r) => r.network === network);
  const rescuedTotal = records.reduce((sum, r) => sum + r.amount, 0);
  const rescuedCount = records.length;

  if (!address || !RPC_URL[network]) {
    return { address, balance: null, rescuedTotal, rescuedCount };
  }
  try {
    const balance = await rpcBalanceOf(STRK_TOKEN, address, network);
    return { address, balance: Number(balance) / 1e18, rescuedTotal, rescuedCount };
  } catch {
    return { address, balance: null, rescuedTotal, rescuedCount };
  }
}

export async function GET() {
  const ledger = await getLedger();
  const [mainnet, sepolia] = await Promise.all([
    vaultInfo("mainnet", ledger),
    vaultInfo("sepolia", ledger),
  ]);
  return NextResponse.json({ mainnet, sepolia, ledgerAvailable });
}
