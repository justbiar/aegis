"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { ExternalLink, Loader2, KeyRound } from "lucide-react";

interface Claimable {
  repoUrl: string;
  network: "mainnet" | "sepolia";
  amount: number;
}

interface Claim {
  repoUrl: string;
  network: "mainnet" | "sepolia";
  amount: number;
  status: "pending" | "paid";
  paidTxHash?: string;
  paidPrivately?: boolean;
}

export function ClaimPanel() {
  const { data: session, status } = useSession();
  const [claimable, setClaimable] = useState<Claimable[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});

  const load = () => {
    fetch("/api/claims?scope=mine")
      .then((r) => r.json())
      .then((d) => {
        setClaimable(d.claimable ?? []);
        setClaims(d.claims ?? []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (status === "authenticated") load();
  }, [status]);

  const submit = async (c: Claimable) => {
    const key = `${c.repoUrl}::${c.network}`;
    const starknetAddress = addresses[key]?.trim();
    if (!starknetAddress) {
      setError((e) => ({ ...e, [key]: "Enter the Starknet address that should receive this" }));
      return;
    }
    setSubmitting(key);
    setError((e) => ({ ...e, [key]: "" }));
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: c.repoUrl, network: c.network, starknetAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit claim");
      load();
    } catch (e: any) {
      setError((err) => ({ ...err, [key]: e.message ?? "Failed to submit claim" }));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section id="claim" className="py-16 border-y border-ls-gray-200 dark:border-ls-gray-800 bg-ls-gray-50 dark:bg-ls-gray-900/40">
      <div className="section-container max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-widest text-ls-gray-400 mb-3">
          Claim
        </p>
        <h2 className="text-2xl font-bold text-black dark:text-white mb-3">
          Was one of your repos rescued?
        </h2>
        <p className="text-ls-gray-500 dark:text-ls-gray-400 mb-8">
          Sign in with the GitHub account that owns the repo — we check your
          login against the repo's owner and the rescue ledger, no manual
          proof needed.
        </p>

        {status !== "authenticated" ? (
          <button
            onClick={() => signIn("github")}
            disabled={status === "loading"}
            className="btn-primary text-sm px-6 py-3 flex items-center gap-2 disabled:opacity-50"
          >
            <KeyRound size={16} /> Connect GitHub
          </button>
        ) : claimable.length === 0 && claims.length === 0 ? (
          <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
            Signed in as <span className="font-semibold">{session?.user?.name ?? "you"}</span> — no rescues on record for repos you own.
          </p>
        ) : (
          <>
            {claimable.map((c) => {
              const key = `${c.repoUrl}::${c.network}`;
              return (
                <div key={key} className="ls-card mb-4">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div>
                      <p className="font-semibold text-black dark:text-white">
                        {c.repoUrl.replace("https://github.com/", "")}
                      </p>
                      <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
                        {c.amount.toFixed(4)} STRK rescued on {c.network}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      placeholder="Your Starknet address, registered with the pool (paid out as a private transfer)"
                      value={addresses[key] ?? ""}
                      onChange={(e) => setAddresses((a) => ({ ...a, [key]: e.target.value }))}
                      className="flex-1 px-3 py-2 text-sm rounded-lg border border-ls-gray-300 dark:border-ls-gray-700
                        bg-white dark:bg-ls-black text-black dark:text-white"
                    />
                    <button
                      onClick={() => submit(c)}
                      disabled={submitting === key}
                      className="btn-primary text-sm px-5 py-2 whitespace-nowrap disabled:opacity-50"
                    >
                      {submitting === key ? <Loader2 size={14} className="animate-spin" /> : "Claim"}
                    </button>
                  </div>
                  {error[key] && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error[key]}</p>}
                </div>
              );
            })}

            {claims.map((c) => (
              <div key={`${c.repoUrl}::${c.network}`} className="ls-card mb-4 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-black dark:text-white">
                    {c.repoUrl.replace("https://github.com/", "")}
                  </p>
                  <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
                    {c.amount.toFixed(4)} STRK · {c.network}
                  </p>
                </div>
                {c.status === "paid" ? (
                  <a
                    href={`https://${c.network === "sepolia" ? "sepolia." : ""}voyager.online/tx/${c.paidTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="tag-clean flex items-center gap-1"
                  >
                    {c.paidPrivately ? "Paid privately" : "Paid"} <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="tag-pending">Pending payout</span>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
