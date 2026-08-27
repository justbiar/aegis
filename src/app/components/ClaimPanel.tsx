"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { ExternalLink, Loader2, KeyRound, CheckCircle2, Clock3, Sparkles, Check, Wallet2, ShieldCheck } from "lucide-react";
import * as constants from "@/utils/constants";
import { useStoreWallet } from "./Wallet/walletContext";
import { useFrontendProvider } from "./client/provider/providerContext";
import SelectWallet from "./client/WalletHandle/SelectWallet";
import PayClaimsBatch, { computePayouts, type BatchClaim } from "./client/WalletHandle/PayClaimsBatch";
import RegisterWallet from "./client/WalletHandle/RegisterWallet";

const DEFAULT_TIP_PERCENT = 2;
// GitHub login that, combined with the safe wallet, unlocks the admin payout
// panel. Public username, safe to expose client-side.
const ADMIN_LOGIN = (process.env.NEXT_PUBLIC_ADMIN_GITHUB_LOGIN ?? "justbiar").toLowerCase();

// Starknet addresses can differ in string form (leading zeros) while being
// the same value, so compare as BigInt rather than string equality.
function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

function txUrl(network: NetworkKey, txHash: string): string {
  return `https://${network === "sepolia" ? "sepolia." : ""}voyager.online/tx/${txHash}`;
}

function shortAddr(a?: string | null): string {
  if (!a) return "";
  return a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
}

type NetworkKey = "mainnet" | "sepolia";

// Frontend provider index that each pool network lives on (see constants.ts:
// 0 = Mainnet, 2 = Sepolia).
const NETWORK_INDEX: Record<NetworkKey, number> = { mainnet: 0, sepolia: 2 };

interface RescueProof {
  txHash: string;
  amount: number;
  accountAddress: string | null;
  verified: boolean;
}

interface Claimable {
  repoUrl: string;
  network: NetworkKey;
  amount: number;
  /** Rescued STRK proven against the chain. */
  verified: number;
  /** Ledger lines with no usable proof — left out of `amount`. */
  unverified: number;
  /** STRK the vault sent back to the leaked account and swept again. */
  refunded: number;
  /** The vault doesn't currently hold enough to back the full amount. */
  cappedByBalance: boolean;
  proofs: RescueProof[];
}

interface Claim {
  repoUrl: string;
  network: NetworkKey;
  amount: number;
  status: "pending" | "paid";
  starknetAddress: string;
  tipPercent: number;
  githubLogin?: string;
  paidTxHash?: string;
  paidPrivately?: boolean;
  paidNet?: number;
}

// Where a claimable figure comes from: the repo the key leaked in, the rescue
// transactions that put the STRK in the vault, and anything the number was
// reduced by. An owner is being asked to trust a payout is owed to them, so
// the evidence travels with the amount rather than living in a ledger nobody
// can see.
function ProvenanceNote({ claimable }: { claimable: Claimable }) {
  const proven = claimable.proofs.filter((p) => p.verified);
  const account = proven.find((p) => p.accountAddress)?.accountAddress ?? null;

  return (
    <div className="rounded-xl border border-ls-gray-200 dark:border-ls-gray-700 bg-ls-gray-50 dark:bg-ls-gray-800/60 px-4 py-3">
      <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
        <ShieldCheck size={13} /> Source verified on-chain
      </p>
      <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400 mt-1.5">
        A key committed to{" "}
        <a href={claimable.repoUrl} target="_blank" rel="noreferrer" className="font-semibold text-black dark:text-white hover:underline">
          {claimable.repoUrl.replace("https://github.com/", "")}
        </a>{" "}
        funded{" "}
        {account ? (
          <span className="font-mono">{shortAddr(account)}</span>
        ) : (
          "an account"
        )}
        , and {proven.length === 1 ? "this transaction" : `these ${proven.length} transactions`} swept it into the Aegis vault:
      </p>
      <ul className="mt-2 space-y-1">
        {proven.slice(0, 4).map((p) => (
          <li key={p.txHash} className="text-xs flex items-center justify-between gap-3">
            <a href={txUrl(claimable.network, p.txHash)} target="_blank" rel="noreferrer" className="link-arrow font-mono">
              {p.txHash.slice(0, 10)}…{p.txHash.slice(-4)} <ExternalLink size={10} />
            </a>
            <span className="tabular-nums text-ls-gray-500 dark:text-ls-gray-400">{p.amount.toFixed(4)} STRK</span>
          </li>
        ))}
        {proven.length > 4 && (
          <li className="text-xs text-ls-gray-400">+ {proven.length - 4} more</li>
        )}
      </ul>
      {(claimable.refunded > 0.0001 || claimable.unverified > 0.0001 || claimable.cappedByBalance) && (
        <ul className="mt-2.5 pt-2.5 border-t border-ls-gray-200 dark:border-ls-gray-700 space-y-1 text-xs text-ls-gray-500 dark:text-ls-gray-400">
          {claimable.refunded > 0.0001 && (
            <li>
              −{claimable.refunded.toFixed(4)} STRK the vault sent back to that account and rescued again — the same
              money, so it is only claimable once.
            </li>
          )}
          {claimable.unverified > 0.0001 && (
            <li>−{claimable.unverified.toFixed(4)} STRK logged as rescued but not provable on-chain.</li>
          )}
          {claimable.cappedByBalance && <li>Limited by what the vault currently holds.</li>}
        </ul>
      )}
    </div>
  );
}

function TipSlider({ value, onChange, amount }: { value: number; onChange: (v: number) => void; amount: number }) {
  const tipAmount = amount * (value / 100);
  const afterTip = amount - tipAmount;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
        <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
          Support the developer · <span className="font-semibold text-black dark:text-white">{value}%</span> ({tipAmount.toFixed(4)} STRK)
        </p>
        <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">After tip: {afterTip.toFixed(4)} STRK</p>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-label="Percentage of your rescue you want to tip the developer"
        aria-valuetext={`${value}% tip, ${afterTip.toFixed(4)} STRK before the network fee`}
      />
      <p className="text-[11px] text-ls-gray-400 mt-1.5">
        A shared ~6 STRK network fee is also deducted from your payout when it&apos;s sent.
      </p>
    </div>
  );
}

// A payout can land on-chain and still fail to be written down — the wallet
// sends the transfer, then the call that records it is rejected or never
// arrives, and the claim sits pending while the STRK is already gone. Paying
// again would be the expensive way to fix that, so the operator can settle the
// record against the hash that already paid it. Bookkeeping only: the endpoint
// still requires the operator's session and still checks the transaction
// touched the pool.
function RecordPayment({
  repoUrl,
  network,
  net,
  onRecorded,
}: {
  repoUrl: string;
  network: NetworkKey;
  net: number;
  onRecorded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/claims/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, network, txHash: txHash.trim(), net }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setOpen(false);
      onRecorded();
    } catch (err: any) {
      setError(err?.message ?? "Request failed");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-[11px] text-ls-gray-500 dark:text-ls-gray-400 hover:text-black dark:hover:text-white transition-colors"
      >
        Already paid this one? Record the transaction →
      </button>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-ls-gray-100 dark:border-ls-gray-800 space-y-2">
      <p className="text-[11px] text-ls-gray-500 dark:text-ls-gray-400">
        Paste the pool transaction that paid it. This only settles the record — no funds move.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={txHash}
          onChange={(e) => setTxHash(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
          className="flex-1 min-w-0 rounded-lg border border-ls-gray-300 dark:border-ls-gray-700 bg-transparent px-3 py-1.5 text-xs font-mono text-black dark:text-white"
          aria-label="Transaction hash that paid this claim"
        />
        <div className="flex items-center gap-2">
          <button onClick={submit} disabled={busy || txHash.trim().length < 4} className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : "Record"}
          </button>
          <button onClick={() => setOpen(false)} className="btn-ghost text-xs px-3 py-1.5">
            Cancel
          </button>
        </div>
      </div>
      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// Network segmented toggle, shared by both modes.
function NetworkToggle({
  selected,
  onSelect,
  count,
}: {
  selected: NetworkKey;
  onSelect: (n: NetworkKey) => void;
  count: (n: NetworkKey) => number;
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 mb-6 rounded-xl bg-ls-gray-100 dark:bg-ls-gray-900 border border-ls-gray-200 dark:border-ls-gray-800">
      {(["mainnet", "sepolia"] as NetworkKey[]).map((n) => {
        const active = selected === n;
        const c = count(n);
        return (
          <button
            key={n}
            onClick={() => onSelect(n)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-colors flex items-center gap-2 ${
              active
                ? "bg-white dark:bg-ls-gray-700 text-black dark:text-white shadow-sm"
                : "text-ls-gray-500 dark:text-ls-gray-400 hover:text-black dark:hover:text-white"
            }`}
          >
            {n}
            {c > 0 && (
              <span
                className={`text-[11px] font-bold px-1.5 rounded-full ${
                  active ? "bg-black text-white dark:bg-white dark:text-black" : "bg-ls-gray-200 dark:bg-ls-gray-800"
                }`}
              >
                {c}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ClaimPanel() {
  const { data: session, status } = useSession();
  const login = (session?.user as any)?.login as string | undefined;
  const isWalletConnected = useStoreWallet((s) => s.isConnected);
  const walletAddress = useStoreWallet((s) => s.address);
  const myFrontendProviderIndex = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const setFrontendProviderIndex = useFrontendProvider((s) => s.setCurrentFrontendProviderIndex);
  const walletNetworkName = constants.Strk20Networks[myFrontendProviderIndex];

  const [claimable, setClaimable] = useState<Claimable[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [adminPending, setAdminPending] = useState<Claim[]>([]);
  const [tips, setTips] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [safeAddresses, setSafeAddresses] = useState<Record<NetworkKey, string | null>>({
    mainnet: null,
    sepolia: null,
  });

  useEffect(() => {
    fetch("/api/vault")
      .then((r) => r.json())
      .then((d) => setSafeAddresses({ mainnet: d.mainnet?.address ?? null, sepolia: d.sepolia?.address ?? null }))
      .catch(() => {});
  }, []);

  const selectedNetwork: NetworkKey = myFrontendProviderIndex === NETWORK_INDEX.mainnet ? "mainnet" : "sepolia";

  const walletNetworkKey = walletNetworkName?.toLowerCase() as NetworkKey | undefined;
  const isSafeWallet =
    isWalletConnected && !!walletNetworkKey && sameAddress(walletAddress, safeAddresses[walletNetworkKey]);
  const receivingFromWallet = isWalletConnected && !!walletAddress && !isSafeWallet;
  // Admin = the safe wallet operator, signed in as the project's GitHub. Any
  // other wallet (a receiving wallet, the leaked wallet, anything) is a normal
  // claimant, even under the same GitHub login.
  const isAdmin = isSafeWallet && !!login && login.toLowerCase() === ADMIN_LOGIN;

  const loadMine = () => {
    fetch("/api/claims?scope=mine")
      .then((r) => r.json())
      .then((d) => {
        setClaimable(d.claimable ?? []);
        setClaims(d.claims ?? []);
      })
      .catch(() => {});
  };

  const loadPending = () => {
    fetch("/api/claims?scope=pending")
      .then((r) => r.json())
      .then((d) => setAdminPending(d.claims ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    if (status === "authenticated") loadMine();
  }, [status]);

  useEffect(() => {
    if (isAdmin) loadPending();
  }, [isAdmin]);

  // Submit / update a claim — the receiving address is always the connected
  // wallet (DEX-style "connect to receive"), so there's no hand-typed address
  // to validate, just a wallet to require.
  const submit = async (repoUrl: string, network: NetworkKey, tipPercent: number) => {
    const key = `${repoUrl}::${network}`;
    if (!receivingFromWallet) {
      setError((e) => ({ ...e, [key]: "Connect the wallet that should receive this first" }));
      return;
    }
    setSubmitting(key);
    setError((e) => ({ ...e, [key]: "" }));
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, network, starknetAddress: walletAddress, tipPercent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit claim");
      loadMine();
    } catch (e: any) {
      setError((err) => ({ ...err, [key]: e.message ?? "Failed to submit claim" }));
    } finally {
      setSubmitting(null);
    }
  };

  const renderAddressField = (savedAddr?: string) => {
    if (receivingFromWallet) {
      return (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-ls-gray-50 dark:bg-ls-gray-800/60 border border-ls-gray-200 dark:border-ls-gray-700 px-4 py-2.5">
          <div className="min-w-0">
            <p className="font-mono text-sm text-black dark:text-white truncate">{shortAddr(walletAddress)}</p>
            <p className="text-[11px] text-ls-gray-400">Receiving to your connected wallet</p>
          </div>
          <SelectWallet variant="change" />
        </div>
      );
    }
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-dashed border-ls-gray-300 dark:border-ls-gray-700 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Wallet2 size={15} className="text-ls-gray-400 shrink-0" />
          <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400 min-w-0">
            {savedAddr ? (
              <>Receiving to <span className="font-mono">{shortAddr(savedAddr)}</span> — connect that wallet to change it.</>
            ) : (
              "Connect the wallet that should receive this."
            )}
          </p>
        </div>
        <SelectWallet variant="nav" />
      </div>
    );
  };

  // ── Shared header ──────────────────────────────────────────────────────
  const header = (
    <>
      <p className="eyebrow">{isAdmin ? "Admin · payout queue" : "Claim"}</p>
      <h2 className="font-display text-2xl lg:text-3xl font-semibold text-black dark:text-white tracking-tight mb-3">
        {isAdmin ? "Pending payout requests" : "Was one of your repos rescued?"}
      </h2>
      <p className="text-ls-gray-500 dark:text-ls-gray-400 mb-8">
        {isAdmin ? (
          <>
            Connected as the Aegis safe wallet (<span className="font-mono">{shortAddr(walletAddress)}</span>). Every
            request below was submitted by a verified repo owner with the destination and tip they chose — pay them out
            privately in one batch.
          </>
        ) : (
          <>
            Sign in with the GitHub account that owns the repo, connect the wallet that should receive the funds, then
            request your payout — the Aegis safe wallet sends it privately.
          </>
        )}
      </p>
    </>
  );

  // ── ADMIN PANEL ────────────────────────────────────────────────────────
  if (status === "authenticated" && isAdmin) {
    const adminForNet = adminPending.filter((c) => c.network === selectedNetwork);
    const batchClaims: BatchClaim[] = adminForNet.map((c) => ({
      repoUrl: c.repoUrl,
      network: c.network,
      amount: c.amount,
      tipPercent: c.tipPercent,
      starknetAddress: c.starknetAddress,
      githubLogin: c.githubLogin,
    }));
    const payouts = computePayouts(batchClaims);
    const adminCount = (n: NetworkKey) => adminPending.filter((c) => c.network === n).length;

    return (
      <section id="claim" className="py-16">
        <div className="section-container max-w-2xl">
          {header}
          <NetworkToggle selected={selectedNetwork} onSelect={(n) => setFrontendProviderIndex(NETWORK_INDEX[n])} count={adminCount} />

          <RegisterWallet network={selectedNetwork} onRegistered={loadPending} />

          {adminForNet.length === 0 ? (
            <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
              No pending requests on <span className="font-semibold capitalize">{selectedNetwork}</span>.
            </p>
          ) : (
            <>
              <div className="ls-card mb-4 border-emerald-200 dark:border-emerald-800/60">
                <p className="text-xs font-bold uppercase tracking-widest text-ls-gray-400 mb-1">
                  Batch payout · <span className="capitalize">{selectedNetwork}</span>
                </p>
                <p className="text-sm text-ls-gray-600 dark:text-ls-gray-300 mb-3">
                  {adminForNet.length} pending {adminForNet.length === 1 ? "request" : "requests"} — one private transaction,
                  one pool fee shared across them.
                </p>
                <PayClaimsBatch claims={batchClaims} network={selectedNetwork} onPaid={loadPending} />
              </div>

              {payouts.map((r) => {
                const c = r.claim;
                return (
                  <div key={`${c.repoUrl}::${c.network}`} className="ls-card mb-3">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <span className="tag-pending inline-flex items-center gap-1.5 mb-2">
                          <Clock3 size={11} /> Pending
                        </span>
                        <p className="font-semibold text-black dark:text-white truncate">
                          {c.repoUrl.replace("https://github.com/", "")}
                        </p>
                        {c.githubLogin && <p className="text-xs text-ls-gray-400">@{c.githubLogin}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="hero-stat text-2xl text-black dark:text-white leading-none tracking-tight">
                          {r.payable ? r.net.toFixed(4) : "—"}
                        </p>
                        <p className="text-[11px] font-semibold text-ls-gray-400 mt-0.5">STRK net</p>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-ls-gray-100 dark:border-ls-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <p className="text-ls-gray-400">Rescued</p>
                        <p className="font-semibold text-black dark:text-white tabular-nums">{c.amount.toFixed(4)}</p>
                      </div>
                      <div>
                        <p className="text-ls-gray-400">Tip {c.tipPercent}%</p>
                        <p className="font-semibold text-black dark:text-white tabular-nums">−{r.tipAmount.toFixed(4)}</p>
                      </div>
                      <div>
                        <p className="text-ls-gray-400">Fee share</p>
                        <p className="font-semibold text-black dark:text-white tabular-nums">−{r.feeShare.toFixed(4)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-ls-gray-400">To</p>
                        <p className="font-mono text-black dark:text-white truncate">{shortAddr(c.starknetAddress)}</p>
                      </div>
                    </div>
                    <RecordPayment repoUrl={c.repoUrl} network={c.network} net={r.net} onRecorded={loadPending} />
                    {!r.payable && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                        Too small to cover its fee share right now — left pending.
                      </p>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </section>
    );
  }

  // ── CLAIMANT (normal user) PANEL ───────────────────────────────────────
  const visibleClaimable = claimable.filter((c) => c.network === selectedNetwork);
  const visibleClaims = claims.filter((c) => c.network === selectedNetwork);
  const hasAny = claimable.length > 0 || claims.length > 0;
  const netCount = (n: NetworkKey) =>
    claimable.filter((c) => c.network === n).length + claims.filter((c) => c.network === n).length;

  return (
    <section id="claim" className="py-16">
      <div className="section-container max-w-2xl">
        {header}

        {status !== "authenticated" ? (
          <button
            onClick={() => signIn("github")}
            disabled={status === "loading"}
            className="btn-primary text-sm px-6 py-3 disabled:opacity-50"
          >
            <KeyRound size={16} /> Connect GitHub
          </button>
        ) : !hasAny ? (
          <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
            Signed in as <span className="font-semibold">{session?.user?.name ?? "you"}</span> — no rescues on record for repos you own.
          </p>
        ) : (
          <>
            <NetworkToggle selected={selectedNetwork} onSelect={(n) => setFrontendProviderIndex(NETWORK_INDEX[n])} count={netCount} />

            {/* If the claimant's receiving wallet isn't registered with the pool,
                let them register it here so the payout can actually reach them. */}
            <RegisterWallet network={selectedNetwork} onRegistered={loadMine} />

            {visibleClaimable.length === 0 && visibleClaims.length === 0 ? (
              <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
                Nothing on <span className="font-semibold capitalize">{selectedNetwork}</span> — switch networks above to see your other claims.
              </p>
            ) : (
              <>
                {/* Ready-to-claim (not yet submitted) */}
                {visibleClaimable.map((c) => {
                  const key = `${c.repoUrl}::${c.network}`;
                  const tip = tips[key] ?? DEFAULT_TIP_PERCENT;
                  return (
                    <div key={key} className="ls-card mb-4">
                      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                        <div className="min-w-0">
                          <span className="tag-ready inline-flex items-center gap-1.5 mb-2">
                            <Sparkles size={11} /> Ready to claim
                          </span>
                          <p className="font-semibold text-black dark:text-white truncate">
                            {c.repoUrl.replace("https://github.com/", "")}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="hero-stat text-4xl text-black dark:text-white leading-none tracking-tight">
                            {c.amount.toFixed(4)}
                          </p>
                          <p className="text-xs font-semibold text-ls-gray-400 mt-0.5">STRK</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <ProvenanceNote claimable={c} />
                        {renderAddressField()}
                        <TipSlider value={tip} onChange={(v) => setTips((t) => ({ ...t, [key]: v }))} amount={c.amount} />
                        {receivingFromWallet && (
                          <button
                            onClick={() => submit(c.repoUrl, c.network, tip)}
                            disabled={submitting === key}
                            className="btn-primary text-sm px-5 py-2 disabled:opacity-50"
                          >
                            {submitting === key ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> Request payout</>}
                          </button>
                        )}
                      </div>
                      {error[key] && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error[key]}</p>}
                    </div>
                  );
                })}

                {/* Submitted claims (pending / paid) */}
                {visibleClaims.map((c) => {
                  const key = `${c.repoUrl}::${c.network}`;
                  const tip = tips[key] ?? c.tipPercent;
                  const addrChanged = receivingFromWallet && !sameAddress(walletAddress, c.starknetAddress);
                  const tipChanged = tip !== c.tipPercent;
                  const hasUnsavedEdits = c.status === "pending" && (addrChanged || tipChanged);
                  return (
                    <div key={key} className="ls-card mb-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <span className={c.status === "paid" ? "tag-clean inline-flex items-center gap-1.5 mb-2" : "tag-pending inline-flex items-center gap-1.5 mb-2"}>
                            {c.status === "paid" ? <CheckCircle2 size={11} /> : <Clock3 size={11} />}
                            {c.status === "paid" ? (c.paidPrivately ? "Paid privately" : "Paid") : "Pending payout"}
                          </span>
                          <p className="font-semibold text-black dark:text-white truncate">
                            {c.repoUrl.replace("https://github.com/", "")}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="hero-stat text-4xl text-black dark:text-white leading-none tracking-tight">
                            {c.amount.toFixed(4)}
                          </p>
                          <p className="text-xs font-semibold text-ls-gray-400 mt-0.5">STRK</p>
                          {c.status === "paid" && (
                            <a
                              href={`https://${c.network === "sepolia" ? "sepolia." : ""}voyager.online/tx/${c.paidTxHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="link-arrow text-xs mt-1.5"
                            >
                              View tx <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
                      </div>

                      {c.status === "paid" && (
                        <div className="mt-4 rounded-xl bg-ls-gray-50 dark:bg-ls-gray-800/60 border border-ls-gray-200 dark:border-ls-gray-700 px-4 py-3 space-y-1.5">
                          {typeof c.paidNet === "number" && (
                            <p className="text-sm text-black dark:text-white">
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{c.paidNet.toFixed(4)} STRK</span> sent to your wallet
                              <span className="text-ls-gray-500 dark:text-ls-gray-400"> · after {c.tipPercent}% tip + network fee (of {c.amount.toFixed(4)})</span>
                            </p>
                          )}
                          <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
                            Paid as a private transfer — it lands in your <span className="font-semibold">shielded</span> balance, not your public one. Open your wallet&apos;s privacy / shielded section to see it, then <span className="font-semibold">Unshield</span> to spend it.
                          </p>
                        </div>
                      )}

                      {c.status === "pending" && (
                        <div className="mt-4 space-y-3">
                          {renderAddressField(c.starknetAddress)}
                          <TipSlider value={tip} onChange={(v) => setTips((t) => ({ ...t, [key]: v }))} amount={c.amount} />
                          {error[key] && <p className="text-sm text-red-600 dark:text-red-400">{error[key]}</p>}

                          <div className="pt-1">
                            {hasUnsavedEdits ? (
                              <button
                                onClick={() => submit(c.repoUrl, c.network, tip)}
                                disabled={submitting === key}
                                className="btn-primary text-sm px-5 py-2 disabled:opacity-50"
                              >
                                {submitting === key ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> Save changes</>}
                              </button>
                            ) : (
                              <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400 flex items-start gap-1.5">
                                <Clock3 size={13} className="mt-0.5 shrink-0" />
                                <span>Requested — the Aegis safe wallet pays this out privately (manual, no automatic transfer).</span>
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Subtle operator entry point — connecting the safe wallet
                    switches this whole panel into the admin payout queue. */}
                {visibleClaims.some((c) => c.status === "pending") && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 px-4 py-3 rounded-2xl border border-dashed border-ls-gray-300 dark:border-ls-gray-700">
                    <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400 flex items-center gap-1.5">
                      <ShieldCheck size={14} className="text-ls-gray-400" /> Running payouts? Connect the Aegis safe wallet for the admin queue.
                    </p>
                    {isWalletConnected ? <SelectWallet variant="change" /> : <SelectWallet variant="nav" />}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
