// Append-only log of claim requests, mirroring ledger.ts's pattern. A claim
// is a repo owner (verified via GitHub login matching the repo's owner
// segment) registering the Starknet address that should receive their
// rescued funds. Paying it out is a manual step (see WalletAccountV6Tag's
// "Pay claims" tab) — the operator connects the safe wallet and sends a
// private STRK20 transfer, then /api/claims/pay verifies that transfer
// on-chain before marking the claim paid. Backed by the same KV store as
// the ledger; silently a no-op without it.

import type { Network } from "./networks";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const CLAIMS_KEY = "aegis:claims";

export interface ClaimRecord {
  repoUrl: string;
  githubLogin: string;
  starknetAddress: string;
  amount: number;
  network: Network;
  status: "pending" | "paid";
  requestedAt: number;
  paidTxHash?: string;
  paidAt?: number;
  // true = private in-pool transfer (the "Pay claims" tab); false/undefined
  // = the automatic plain payout in payout.ts. Both leave the recipient
  // with the same STRK, just with different on-chain visibility.
  paidPrivately?: boolean;
  // % of `amount` withheld at payout time (stays with the safe wallet) —
  // covers the network fee the payout itself costs to send, and doubles as
  // an opt-in "support the project" amount above that. Chosen by the
  // claimant, 0-100, defaults to 2.
  tipPercent: number;
}

export const claimsAvailable = Boolean(KV_URL && KV_TOKEN);

export async function getClaims(): Promise<ClaimRecord[]> {
  if (!KV_URL || !KV_TOKEN) return [];
  try {
    const res = await fetch(`${KV_URL}/lrange/${CLAIMS_KEY}/0/-1`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    const raw: string[] = data.result ?? [];
    return raw.map((s) => JSON.parse(s) as ClaimRecord);
  } catch {
    return [];
  }
}

// Claims are stored as a list, so "updating" one (marking it paid) means
// rewriting the whole list — fine at this scale (a handful of claims for a
// hackathon project), not built for high volume.
async function saveClaims(claims: ClaimRecord[]): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  const values = claims.map((c) => JSON.stringify(c));
  await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["del", CLAIMS_KEY],
      ...(values.length > 0 ? [["rpush", CLAIMS_KEY, ...values]] : []),
    ]),
  });
}

export async function recordClaimRequest(claim: ClaimRecord): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/rpush/${CLAIMS_KEY}/${encodeURIComponent(JSON.stringify(claim))}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch {
    // best-effort — matches ledger.ts
  }
}

// Lets a claimant change the destination address or tip percentage while
// still pending — mistyped address, changed their mind about the wallet,
// or want to adjust how much they're leaving behind. Once paid, a claim is
// immutable (nothing to update).
export async function updatePendingClaim(
  repoUrl: string,
  network: Network,
  githubLogin: string,
  updates: { starknetAddress: string; tipPercent: number },
): Promise<boolean> {
  const claims = await getClaims();
  const claim = claims.find(
    (c) =>
      c.repoUrl === repoUrl &&
      c.network === network &&
      c.githubLogin.toLowerCase() === githubLogin.toLowerCase() &&
      c.status === "pending",
  );
  if (!claim) return false;
  claim.starknetAddress = updates.starknetAddress;
  claim.tipPercent = updates.tipPercent;
  await saveClaims(claims);
  return true;
}

export async function markClaimPaid(
  repoUrl: string,
  network: Network,
  paidTxHash: string,
  paidPrivately: boolean,
): Promise<boolean> {
  const claims = await getClaims();
  const claim = claims.find(
    (c) => c.repoUrl === repoUrl && c.network === network && c.status === "pending",
  );
  if (!claim) return false;
  claim.status = "paid";
  claim.paidTxHash = paidTxHash;
  claim.paidAt = Date.now();
  claim.paidPrivately = paidPrivately;
  await saveClaims(claims);
  return true;
}
