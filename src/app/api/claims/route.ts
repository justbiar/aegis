import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLedger } from "@/lib/ledger";
import { getClaims, recordClaimRequest, updatePendingClaim, type ClaimRecord } from "@/lib/claims";

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
import type { Network } from "@/lib/networks";

function repoOwner(repoUrl: string): string | null {
  try {
    const u = new URL(repoUrl);
    if (u.hostname !== "github.com") return null;
    return u.pathname.replace(/^\//, "").split("/")[0]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// GET ?scope=mine (default) — the signed-in user's own claimable rescues
// (ledger total for repos they own, minus anything already claimed) plus
// their existing claim records.
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
    return NextResponse.json({ claims: claims.filter((c) => c.status === "pending") });
  }

  if (!login) return NextResponse.json({ claimable: [], claims: [] });

  const ledger = await getLedger();
  const myClaims = claims.filter((c) => c.githubLogin.toLowerCase() === login.toLowerCase());

  const rescuedByRepoNetwork = new Map<string, number>();
  for (const r of ledger) {
    if (repoOwner(r.repoUrl) !== login.toLowerCase()) continue;
    const key = `${r.repoUrl}::${r.network}`;
    rescuedByRepoNetwork.set(key, (rescuedByRepoNetwork.get(key) ?? 0) + r.amount);
  }

  // How much of each repo/network's rescued total is already spoken for by a
  // claim (pending or paid). Claimable is what's LEFT — so if a repo leaks and
  // is rescued again after an earlier claim was already paid, the new amount
  // shows up as newly claimable instead of vanishing.
  const claimedByRepoNetwork = new Map<string, number>();
  for (const c of myClaims) {
    const key = `${c.repoUrl}::${c.network}`;
    claimedByRepoNetwork.set(key, (claimedByRepoNetwork.get(key) ?? 0) + c.amount);
  }

  const claimable = Array.from(rescuedByRepoNetwork.entries())
    .map(([key, total]) => {
      const [repoUrl, network] = key.split("::") as [string, Network];
      const remaining = total - (claimedByRepoNetwork.get(key) ?? 0);
      return { repoUrl, network, amount: remaining };
    })
    .filter((c) => c.amount > 1e-4);

  return NextResponse.json({ claimable, claims: myClaims });
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

  const ledger = await getLedger();
  const ledgerTotal = ledger
    .filter((r) => r.repoUrl === repoUrl && r.network === network)
    .reduce((sum, r) => sum + r.amount, 0);
  if (ledgerTotal <= 0) {
    return NextResponse.json({ error: "No rescue on record for this repo/network" }, { status: 404 });
  }

  const claims = await getClaims();

  // If there's already a pending claim for this repo/network, this is an edit
  // (fix the address or tip) — not a new one.
  const pending = claims.find(
    (c) => c.repoUrl === repoUrl && c.network === network && c.status === "pending",
  );
  if (pending) {
    // Re-price it against the ledger as it stands now. Between filing and
    // paying, the same repo can be rescued again — that happens routinely,
    // since the key is still public and the account can be refunded minutes
    // later. Everything not already covered by a settled claim belongs to this
    // pending one; leaving the amount frozen at filing time is what stranded
    // the difference as permanently "claimable".
    const settled = claims
      .filter((c) => c.repoUrl === repoUrl && c.network === network && c.status !== "pending")
      .reduce((sum, c) => sum + c.amount, 0);
    const amount = ledgerTotal - settled;

    const updated = await updatePendingClaim(repoUrl, network, login, { starknetAddress, tipPercent, amount });
    if (!updated) {
      return NextResponse.json({ error: "Could not update the pending claim" }, { status: 500 });
    }
    return NextResponse.json({ claim: { ...pending, starknetAddress, tipPercent, amount } });
  }

  // No pending claim — a new one covers whatever's been rescued beyond what
  // earlier (paid) claims already accounted for. Lets the same repo be claimed
  // again after a fresh rescue.
  const claimedTotal = claims
    .filter((c) => c.repoUrl === repoUrl && c.network === network)
    .reduce((sum, c) => sum + c.amount, 0);
  const remaining = ledgerTotal - claimedTotal;
  if (remaining <= 1e-4) {
    return NextResponse.json(
      { error: "Nothing left to claim — the rescued amount for this repo is already claimed or paid" },
      { status: 409 },
    );
  }

  const claim: ClaimRecord = {
    repoUrl,
    githubLogin: login,
    starknetAddress,
    amount: remaining,
    network,
    status: "pending",
    requestedAt: Date.now(),
    tipPercent,
  };
  await recordClaimRequest(claim);
  return NextResponse.json({ claim });
}
