import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLedger } from "@/lib/ledger";
import { getClaims, recordClaimRequest, updatePendingClaim, type ClaimRecord } from "@/lib/claims";

const DEFAULT_TIP_PERCENT = 2;

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
// Not auth-gated: nothing here is sensitive, it's all about to be public
// on-chain the moment it's paid.
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") ?? "mine";
  const claims = await getClaims();

  if (scope === "pending") {
    return NextResponse.json({ claims: claims.filter((c) => c.status === "pending") });
  }

  const session = await auth();
  const login = (session?.user as any)?.login as string | undefined;
  if (!login) return NextResponse.json({ claimable: [], claims: [] });

  const ledger = await getLedger();
  const myClaims = claims.filter((c) => c.githubLogin.toLowerCase() === login.toLowerCase());

  const rescuedByRepoNetwork = new Map<string, number>();
  for (const r of ledger) {
    if (repoOwner(r.repoUrl) !== login.toLowerCase()) continue;
    const key = `${r.repoUrl}::${r.network}`;
    rescuedByRepoNetwork.set(key, (rescuedByRepoNetwork.get(key) ?? 0) + r.amount);
  }

  const claimable = Array.from(rescuedByRepoNetwork.entries())
    .map(([key, total]) => {
      const [repoUrl, network] = key.split("::") as [string, Network];
      const alreadyClaimed = myClaims.some((c) => c.repoUrl === repoUrl && c.network === network);
      return { repoUrl, network, amount: total, alreadyClaimed };
    })
    .filter((c) => !c.alreadyClaimed);

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
  const amount = ledger
    .filter((r) => r.repoUrl === repoUrl && r.network === network)
    .reduce((sum, r) => sum + r.amount, 0);
  if (amount <= 0) {
    return NextResponse.json({ error: "No rescue on record for this repo/network" }, { status: 404 });
  }

  const claims = await getClaims();
  const existing = claims.find((c) => c.repoUrl === repoUrl && c.network === network);
  if (existing) {
    if (existing.status === "paid") {
      return NextResponse.json({ error: "Already paid out" }, { status: 409 });
    }
    // Still pending — let them correct the address or tip (wrong wallet,
    // changed their mind) rather than getting stuck with the first values
    // they picked.
    const updated = await updatePendingClaim(repoUrl, network, login, { starknetAddress, tipPercent });
    if (!updated) {
      return NextResponse.json({ error: "Could not update the pending claim" }, { status: 500 });
    }
    return NextResponse.json({ claim: { ...existing, starknetAddress, tipPercent } });
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
