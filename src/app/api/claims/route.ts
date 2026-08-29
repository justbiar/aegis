import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getClaims, recordClaimRequest, updatePendingClaim, type ClaimRecord } from "@/lib/claims";
import { getProvenance, type NetworkProvenance, type RescueProof } from "@/lib/provenance";
import { rpcBalanceOf } from "@/lib/scan";
import { NETWORKS, SAFE_WALLET, STRK_TOKEN, type Network } from "@/lib/networks";

const DEFAULT_TIP_PERCENT = 2;
// Only this GitHub login (the safe-wallet operator) may read the full pending
// queue, which maps each claimant's login to their payout address — data that
// a private payout otherwise never exposes on-chain.
const ADMIN_LOGIN = (process.env.NEXT_PUBLIC_ADMIN_GITHUB_LOGIN ?? "justbiar").toLowerCase();

function clampTipPercent(raw: unknown): number {
  const n = typeof raw === "number" ? raw : DEFAULT_TIP_PERCENT;
  if (!Number.isFinite(n)) return DEFAULT_TIP_PERCENT;
  return Math.min(100, Math.max(0, n));
}

function repoOwner(repoUrl: string): string | null {
  try {
    const u = new URL(repoUrl);
    if (u.hostname !== "github.com") return null;
    return u.pathname.replace(/^\//, "").split("/")[0]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// What's left to claim on one repo, and the evidence behind it. `amount` is
// what the owner can actually ask for; the rest of the fields exist so the UI
// can show why it isn't simply "everything the ledger says".
interface ClaimableRow {
  repoUrl: string;
  network: Network;
  amount: number;
  /** Rescued STRK proven against the chain (tx exists, succeeded, landed here). */
  verified: number;
  /** Ledger entries that could not be proven — excluded from `amount`. */
  unverified: number;
  /** STRK that came from Aegis or a faucet, not a victim — excluded too. */
  selfFunded: number;
  /** True when the vault simply doesn't hold enough to back the full amount. */
  cappedByBalance: boolean;
  proofs: { txHash: string; amount: number; accountAddress: string | null; verified: boolean }[];
}

async function vaultBalance(network: Network): Promise<number | null> {
  const safe = SAFE_WALLET[network];
  if (!safe) return null;
  try {
    return Number(await rpcBalanceOf(STRK_TOKEN, safe, network)) / 1e18;
  } catch {
    return null;
  }
}

// Claimable per repo = what the chain proves this repo's leak put into the
// vault, minus what's already been claimed against it. Then the whole network
// is held under what the vault actually holds: promising more than the safe
// wallet can pay is how a claim ends up permanently pending.
async function claimableRows(
  claims: ClaimRecord[],
  provenance: Record<Network, NetworkProvenance>,
): Promise<ClaimableRow[]> {
  const claimed = new Map<string, number>();
  for (const c of claims) {
    const key = `${c.repoUrl}::${c.network}`;
    claimed.set(key, (claimed.get(key) ?? 0) + c.amount);
  }

  const rows: ClaimableRow[] = [];
  for (const network of NETWORKS) {
    for (const repo of provenance[network].repos) {
      const remaining = repo.attributable - (claimed.get(`${repo.repoUrl}::${network}`) ?? 0);
      if (remaining <= 1e-4) continue;
      rows.push({
        repoUrl: repo.repoUrl,
        network,
        amount: remaining,
        verified: repo.verified,
        unverified: repo.unverified,
        selfFunded: repo.selfFunded,
        cappedByBalance: false,
        proofs: repo.proofs.map((p: RescueProof) => ({
          txHash: p.txHash,
          amount: p.amount,
          accountAddress: p.accountAddress,
          verified: p.verified,
        })),
      });
    }
  }

  for (const network of NETWORKS) {
    const here = rows.filter((r) => r.network === network);
    if (here.length === 0) continue;
    const balance = await vaultBalance(network);
    if (balance === null) continue;

    // Pending claims are already spoken for out of the same balance.
    const promised = claims
      .filter((c) => c.network === network && c.status === "pending")
      .reduce((sum, c) => sum + c.amount, 0);
    const available = Math.max(0, balance - promised);
    const wanted = here.reduce((sum, r) => sum + r.amount, 0);
    if (wanted <= available) continue;

    // Nobody's claim gets cancelled outright — everyone's shrinks by the same
    // proportion, so the shortfall is shared rather than decided by who asked
    // first.
    const scale = available / wanted;
    for (const row of here) {
      row.amount *= scale;
      row.cappedByBalance = true;
    }
  }

  return rows.filter((r) => r.amount > 1e-4);
}

function claimKey(c: ClaimRecord): string {
  return `${c.repoUrl}::${c.network}::${c.requestedAt}`;
}

// How much of each pending claim the chain still backs. Settled claims are
// served first out of a repo's attributable total — they already took their
// money — and what's left covers the pending ones in the order they were
// filed. A claim can come back partly backed, or not at all.
function backingForPending(
  claims: ClaimRecord[],
  provenance: Record<Network, NetworkProvenance>,
): Map<string, number> {
  const backed = new Map<string, number>();

  for (const network of NETWORKS) {
    for (const repo of provenance[network].repos) {
      const mine = claims.filter((c) => c.repoUrl === repo.repoUrl && c.network === network);
      const settled = mine.filter((c) => c.status !== "pending").reduce((sum, c) => sum + c.amount, 0);
      let left = Math.max(0, repo.attributable - settled);

      for (const claim of mine.filter((c) => c.status === "pending").sort((a, b) => a.requestedAt - b.requestedAt)) {
        const covered = Math.min(claim.amount, left);
        backed.set(claimKey(claim), covered);
        left -= covered;
      }
    }
  }

  // A pending claim on a repo with no provenance at all never enters the loop
  // above, and absence of an entry has to mean "nothing backs this" rather
  // than "unknown" — otherwise the queue would pay it by default.
  for (const claim of claims) {
    if (claim.status !== "pending") continue;
    if (!backed.has(claimKey(claim))) backed.set(claimKey(claim), 0);
  }
  return backed;
}

// GET ?scope=mine (default) — the signed-in user's own claimable rescues
// (what the chain proves was rescued out of repos they own, minus anything
// already claimed and minus anything the vault sent back) plus their existing
// claim records.
// GET ?scope=pending — every pending claim, for the operator payout panel.
// Admin-only: it maps claimant logins to payout addresses, which a private
// payout keeps off-chain, so it must not be world-readable.
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") ?? "mine";
  const claims = await getClaims();

  const session = await auth();
  const login = (session?.user as any)?.login as string | undefined;

  if (scope === "pending") {
    if (!login || login.toLowerCase() !== ADMIN_LOGIN) {
      return NextResponse.json({ error: "Operator only" }, { status: 403 });
    }
    // A claim is priced when it's filed and then sits there, sometimes for
    // days. What backs it can shrink in the meantime — a rescue can turn out
    // to be self-funded, a proof can stop holding — so the queue re-checks
    // every pending claim against the chain as it stands now. Paying one that
    // is no longer backed would be handing out money nobody is owed.
    const provenance = await getProvenance();
    const backed = backingForPending(claims, provenance);
    return NextResponse.json({
      claims: claims
        .filter((c) => c.status === "pending")
        .map((c) => ({ ...c, backedAmount: backed.get(claimKey(c)) ?? 0 })),
    });
  }

  if (!login) return NextResponse.json({ claimable: [], claims: [] });

  const provenance = await getProvenance();
  const myClaims = claims.filter((c) => c.githubLogin.toLowerCase() === login.toLowerCase());

  // Rows are computed for every repo and then filtered to this owner: the
  // balance cap is a network-wide question, so it can't be answered from one
  // owner's slice of the ledger.
  const rows = await claimableRows(claims, provenance);
  const claimable = rows.filter((r) => repoOwner(r.repoUrl) === login.toLowerCase());

  // Claimants see the same backing check the payout queue applies. Without it a
  // request that Aegis will no longer pay still reads as "pending payout" on
  // the owner's own card, which is the one place it must not.
  const backed = backingForPending(claims, provenance);
  return NextResponse.json({
    claimable,
    claims: myClaims.map((c) =>
      c.status === "pending" ? { ...c, backedAmount: backed.get(claimKey(c)) ?? 0 } : c,
    ),
  });
}

// POST { repoUrl, network, starknetAddress } — registers where a verified
// owner's payout should go. Deliberately doesn't pay out here: a private
// payout needs the safe wallet's shielded balance to already hold enough
// funds mixed in with other rescues (see the "Pay claims" tab), and paying
// out the instant a claim lands undermines exactly that — a lone deposit
// followed immediately by a matching withdrawal is the one thing that's
// actually correlatable in this scheme. Sits "pending" until someone pays
// it out privately, batched with whatever else is waiting.
export async function POST(req: NextRequest) {
  const session = await auth();
  const login = (session?.user as any)?.login as string | undefined;
  if (!login) {
    return NextResponse.json({ error: "Sign in with GitHub first" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const repoUrl = body?.repoUrl as string | undefined;
  const network = body?.network as Network | undefined;
  const starknetAddress = body?.starknetAddress as string | undefined;
  const tipPercent = clampTipPercent(body?.tipPercent);
  if (!repoUrl || !network || !starknetAddress) {
    return NextResponse.json({ error: "repoUrl, network and starknetAddress are required" }, { status: 400 });
  }
  if (repoOwner(repoUrl) !== login.toLowerCase()) {
    return NextResponse.json({ error: "You don't own this repo (owner segment doesn't match your GitHub login)" }, { status: 403 });
  }

  const claims = await getClaims();
  const provenance = await getProvenance();

  const repo = provenance[network]?.repos.find((r) => r.repoUrl === repoUrl);
  if (!repo || repo.verified <= 0) {
    return NextResponse.json({ error: "No verified rescue on record for this repo/network" }, { status: 404 });
  }

  // If there's already a pending claim for this repo/network, this is an edit
  // (fix the address or tip) — not a new one. Either way the amount is priced
  // fresh: between filing and paying, the same repo can be rescued again (the
  // key is still public, so the account gets refunded and swept again), and
  // funds can also stop being claimable if the proof behind them doesn't hold
  // up. Pricing the pending claim out of the claim list it belongs to would
  // count it against itself, so it's excluded while its own amount is worked
  // out.
  const pending = claims.find(
    (c) => c.repoUrl === repoUrl && c.network === network && c.status === "pending",
  );
  const others = pending ? claims.filter((c) => c !== pending) : claims;
  const row = (await claimableRows(others, provenance)).find(
    (r) => r.repoUrl === repoUrl && r.network === network,
  );
  const amount = row?.amount ?? 0;
  if (amount <= 1e-4) {
    return NextResponse.json(
      { error: "Nothing left to claim — the rescued amount proven for this repo is already claimed or paid" },
      { status: 409 },
    );
  }

  if (pending) {
    const updated = await updatePendingClaim(repoUrl, network, login, { starknetAddress, tipPercent, amount });
    if (!updated) {
      return NextResponse.json({ error: "Could not update the pending claim" }, { status: 500 });
    }
    return NextResponse.json({ claim: { ...pending, starknetAddress, tipPercent, amount } });
  }

  const claim: ClaimRecord = {
    repoUrl,
    githubLogin: login,
    starknetAddress,
    amount,
    network,
    status: "pending",
    requestedAt: Date.now(),
    tipPercent,
  };
  await recordClaimRequest(claim);
  return NextResponse.json({ claim });
}
