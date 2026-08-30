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

export const DEFAULT_TIP_PERCENT = 2;

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
  // Net STRK actually sent to the recipient at payout (amount − tip − the
  // claim's share of the pool fee). Stored so the paid card can show what the
  // owner really received, not just the gross rescued amount.
  paidNet?: number;
  // Set the instant a payout transaction is signed and broadcast, long before
  // it confirms. A private pool transfer takes minutes to verify its proof, and
  // the claim stays "pending" for all of it — without this marker the payout
  // queue keeps offering the same claim, and paying it again sends the STRK a
  // second time. Cleared only if that transaction turns out not to have landed.
  payoutTxHash?: string;
  payoutAt?: number;
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
    return raw.map((s) => {
      const c = JSON.parse(s) as ClaimRecord;
      // Claims stored before tipPercent existed have no such field - default
      // it on read so old records don't render as NaN everywhere.
      if (typeof c.tipPercent !== "number" || !Number.isFinite(c.tipPercent)) {
        c.tipPercent = DEFAULT_TIP_PERCENT;
      }
      return c;
    });
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
  // `amount` is optional but should normally be passed: a repo can be rescued
  // again while its claim is still pending, and a claim whose amount is frozen
  // at whatever was outstanding when it was filed leaves the difference
  // permanently unclaimable — it shows as claimable, but filing again lands
  // here and only ever edited the address before.
  updates: { starknetAddress: string; tipPercent: number; amount?: number },
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
  if (typeof updates.amount === "number" && updates.amount > 0) claim.amount = updates.amount;
  await saveClaims(claims);
  return true;
}

// A claim's identity in the store. repoUrl + network isn't enough on its own —
// a repo that leaks again is rescued and claimed again — so the filing time
// pins down which record is meant.
function isClaim(c: ClaimRecord, repoUrl: string, network: Network, requestedAt?: number): boolean {
  if (c.repoUrl !== repoUrl || c.network !== network) return false;
  return typeof requestedAt === "number" ? c.requestedAt === requestedAt : c.status === "pending";
}

export interface ClaimRef {
  repoUrl: string;
  network: Network;
  requestedAt?: number;
}

// Records that a payout transaction is out for these claims. Written as one
// read-modify-write for the whole batch: the store is a single list, so marking
// each claim in its own request would have them overwrite each other.
export async function markPayoutSubmitted(refs: ClaimRef[], payoutTxHash: string): Promise<number> {
  const claims = await getClaims();
  let marked = 0;
  for (const ref of refs) {
    const claim = claims.find((c) => isClaim(c, ref.repoUrl, ref.network, ref.requestedAt) && c.status === "pending");
    if (!claim) continue;
    claim.payoutTxHash = payoutTxHash;
    claim.payoutAt = Date.now();
    marked += 1;
  }
  if (marked > 0) await saveClaims(claims);
  return marked;
}

// Undoes the marker when a payout transaction didn't land after all (rejected,
// reverted, dropped), putting the claim back in the queue. Deliberately manual:
// nothing should decide on its own that money didn't move.
export async function clearPayoutSubmitted(ref: ClaimRef): Promise<boolean> {
  const claims = await getClaims();
  const claim = claims.find((c) => isClaim(c, ref.repoUrl, ref.network, ref.requestedAt) && c.status === "pending");
  if (!claim) return false;
  delete claim.payoutTxHash;
  delete claim.payoutAt;
  await saveClaims(claims);
  return true;
}

// Settles every claim one payout transaction covered. This takes the whole
// batch rather than one claim at a time on purpose: the store is a single list
// that each write rewrites end to end, so N concurrent calls all start from the
// same snapshot and the last one to finish erases the others' work — leaving a
// claim that was just paid sitting in the queue as pending, ready to be paid a
// second time. Returns the refs it could not find a pending claim for.
export async function markClaimsPaid(
  entries: (ClaimRef & { net?: number })[],
  paidTxHash: string,
  paidPrivately: boolean,
): Promise<ClaimRef[]> {
  const claims = await getClaims();
  const missed: ClaimRef[] = [];
  const settled = new Set<ClaimRecord>();

  for (const entry of entries) {
    const claim = claims.find(
      (c) =>
        !settled.has(c) &&
        c.status === "pending" &&
        isClaim(c, entry.repoUrl, entry.network, entry.requestedAt),
    );
    if (!claim) {
      missed.push(entry);
      continue;
    }
    settled.add(claim);
    claim.status = "paid";
    claim.paidTxHash = paidTxHash;
    claim.paidAt = Date.now();
    claim.paidPrivately = paidPrivately;
    if (typeof entry.net === "number" && Number.isFinite(entry.net)) claim.paidNet = entry.net;
  }

  if (settled.size > 0) await saveClaims(claims);
  return missed;
}
