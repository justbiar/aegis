import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { clearPayoutSubmitted, markPayoutSubmitted, type ClaimRef } from "@/lib/claims";
import type { Network } from "@/lib/networks";

// Same operator gate as the rest of the payout path.
const ADMIN_LOGIN = (process.env.NEXT_PUBLIC_ADMIN_GITHUB_LOGIN ?? "justbiar").toLowerCase();

async function operator(): Promise<boolean> {
  const session = await auth();
  const login = ((session?.user as any)?.login as string | undefined)?.toLowerCase();
  return login === ADMIN_LOGIN;
}

function parseRefs(raw: unknown): ClaimRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: any) => {
    const repoUrl = typeof r?.repoUrl === "string" ? r.repoUrl : null;
    const network = r?.network as Network | undefined;
    if (!repoUrl || (network !== "mainnet" && network !== "sepolia")) return [];
    const requestedAt = typeof r?.requestedAt === "number" ? r.requestedAt : undefined;
    return [{ repoUrl, network, requestedAt }];
  });
}

// POST { claims: [{ repoUrl, network, requestedAt }], txHash } — called the
// moment a payout transaction is broadcast, before it confirms.
//
// The claim can't be marked paid yet: /api/claims/pay only accepts a
// SUCCEEDED transaction, and a private pool transfer spends minutes proving
// itself. Everything in between is the dangerous window — the claim still
// reads as pending, so any reload, second tab, or remounted panel offers the
// operator the very same payout again, and paying it sends the STRK twice.
// This marks the claim as spoken for so the queue stops offering it.
export async function POST(req: NextRequest) {
  if (!(await operator())) {
    return NextResponse.json({ error: "Only the Aegis operator can record payouts" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const txHash = typeof body?.txHash === "string" ? body.txHash : null;
  const refs = parseRefs(body?.claims);
  if (!txHash || refs.length === 0) {
    return NextResponse.json({ error: "txHash and at least one claim are required" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, marked: await markPayoutSubmitted(refs, txHash) });
}

// DELETE { repoUrl, network, requestedAt } — releases a claim whose payout
// transaction never landed, putting it back in the queue. Only the operator
// can judge that: the marker exists precisely because "not confirmed yet" and
// "never happened" look identical from here.
export async function DELETE(req: NextRequest) {
  if (!(await operator())) {
    return NextResponse.json({ error: "Only the Aegis operator can release payouts" }, { status: 403 });
  }
  const [ref] = parseRefs([await req.json().catch(() => null)]);
  if (!ref) return NextResponse.json({ error: "repoUrl and a valid network are required" }, { status: 400 });
  const cleared = await clearPayoutSubmitted(ref);
  if (!cleared) return NextResponse.json({ error: "No matching pending claim found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
