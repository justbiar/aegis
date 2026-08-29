import { NextResponse } from "next/server";
import { rpcBalanceOf } from "@/lib/scan";
import { SAFE_WALLET, RPC_URL, STRK_TOKEN, type Network } from "@/lib/networks";
import { ledgerAvailable } from "@/lib/ledger";
import { getProvenance, isSelfTestRepo, type NetworkProvenance } from "@/lib/provenance";
import { getClaims } from "@/lib/claims";

interface NetworkVaultInfo {
  address: string | null;
  balance: number | null;
  // Rescues proven against the chain — a real tx that succeeded and moved this
  // STRK into the vault. Unproven ledger lines are reported separately rather
  // than folded in, because they're the ones nobody can claim.
  rescuedTotal: number;
  rescuedCount: number;
  unverifiedTotal: number;
  unverifiedCount: number;
  // STRK that reached the leaked accounts from Aegis's own wallet or a faucet
  // rather than from a victim. Sweeping it back recovered nothing, so it is
  // subtracted rather than counted as a rescue.
  selfFundedTotal: number;
  // Rescued out of leaks Aegis planted itself (its own test fixture). Real
  // work, real transactions, but nobody lost this money — so it is reported
  // and never claimable.
  selfTestTotal: number;
  // rescuedTotal − selfFundedTotal: funds here that trace back to a real leak
  // in a known repo. Everything else in the balance arrived from somewhere
  // Aegis can't account for and is nobody's to claim.
  attributableTotal: number;
  unattributedBalance: number | null;
  // How much verified owners have requested back that hasn't been paid out yet
  // (sum of pending claim amounts on this network) and how many such claims.
  requestedTotal: number;
  requestedCount: number;
}

async function vaultInfo(
  network: Network,
  provenance: NetworkProvenance,
  claims: Awaited<ReturnType<typeof getClaims>>
): Promise<NetworkVaultInfo> {
  const address = SAFE_WALLET[network];
  const proofs = provenance.repos.flatMap((r) => r.proofs);

  // Drills are excluded here too — a request nobody can see or act on should
  // not sit in the banner as STRK someone is waiting for.
  const pending = claims.filter(
    (c) => c.network === network && c.status === "pending" && !isSelfTestRepo(c.repoUrl),
  );

  const base = {
    address,
    rescuedTotal: provenance.verified,
    rescuedCount: proofs.filter((p) => p.verified).length,
    unverifiedTotal: provenance.unverified,
    unverifiedCount: proofs.filter((p) => !p.verified).length,
    selfFundedTotal: provenance.selfFunded,
    selfTestTotal: provenance.selfTestTotal,
    attributableTotal: provenance.attributable,
    requestedTotal: pending.reduce((sum, c) => sum + c.amount, 0),
    requestedCount: pending.length,
  };
  if (!address || !RPC_URL[network]) {
    return { ...base, balance: null, unattributedBalance: null };
  }
  try {
    const balance = Number(await rpcBalanceOf(STRK_TOKEN, address, network)) / 1e18;
    return { ...base, balance, unattributedBalance: Math.max(0, balance - provenance.attributable) };
  } catch {
    return { ...base, balance: null, unattributedBalance: null };
  }
}

export async function GET() {
  const [provenance, claims] = await Promise.all([getProvenance(), getClaims()]);
  const [mainnet, sepolia] = await Promise.all([
    vaultInfo("mainnet", provenance.mainnet, claims),
    vaultInfo("sepolia", provenance.sepolia, claims),
  ]);
  return NextResponse.json({ mainnet, sepolia, ledgerAvailable });
}
