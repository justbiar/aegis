"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { num } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import * as constants from "@/utils/constants";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";

const TOKEN = constants.addrSTRK;

// Flat pool fee per apply_actions call (see strk20-hackathon issue #156). It's
// charged once per call regardless of how many transfers are inside — so it's
// split across the batch and deducted from each recipient's payout, rather
// than the safe wallet eating it.
export const POOL_FEE_STRK = 6;

export interface BatchClaim {
  repoUrl: string;
  network: "mainnet" | "sepolia";
  amount: number;
  tipPercent: number;
  starknetAddress: string;
  githubLogin?: string;
}

// Per-claim payout math, shared with the panel so the numbers it shows match
// exactly what gets sent. The flat pool fee is split proportionally to each
// claim's amount, then that share plus the claimant's tip is deducted. A claim
// whose net comes out <= 0 (its slice can't cover the fee) is left unpaid.
export function computePayouts(claims: BatchClaim[], poolFee = POOL_FEE_STRK) {
  const sumAmount = claims.reduce((s, c) => s + c.amount, 0);
  return claims.map((c) => {
    const feeShare = sumAmount > 0 ? poolFee * (c.amount / sumAmount) : poolFee;
    const tipAmount = c.amount * (c.tipPercent / 100);
    const net = c.amount - tipAmount - feeShare;
    return { claim: c, feeShare, tipAmount, net, payable: net > 0 };
  });
}

interface Props {
  claims: BatchClaim[];
  network: "mainnet" | "sepolia";
  onPaid: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "confirming" }
  | { kind: "ok"; txHash: string }
  | { kind: "error"; message: string };

// Pays every payable pending claim on one network in a SINGLE private
// apply_actions call, so the flat pool fee is paid once and split across the
// recipients instead of once per claim.
export default function PayClaimsBatch({ claims, network, onPaid }: Props) {
  const myWalletAccount = useStoreWallet((s) => s.myWalletAccount);
  const connectedAddress = useStoreWallet((s) => s.address);
  const isConnected = useStoreWallet((s) => s.isConnected);
  const myFrontendProviderIndex = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const networkName = constants.Strk20Networks[myFrontendProviderIndex];

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Pool registration state — a private transfer needs both the sender and
  // every recipient registered (see isRegisteredInPool). Checked read-only so
  // the batch can skip unregistered recipients and explain why, instead of
  // reverting the whole tx with an opaque NOT_REGISTERED.
  const [senderReg, setSenderReg] = useState<boolean | null>(null);
  const [recipReg, setRecipReg] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !connectedAddress) {
      setSenderReg(null);
      setRecipReg({});
      return;
    }
    setChecking(true);
    (async () => {
      const s = await constants.isRegisteredInPool(myFrontendProviderIndex, connectedAddress);
      const entries = await Promise.all(
        claims.map(async (c) => [c.starknetAddress, await constants.isRegisteredInPool(myFrontendProviderIndex, c.starknetAddress)] as const)
      );
      if (cancelled) return;
      setSenderReg(s);
      setRecipReg(Object.fromEntries(entries));
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAddress, isConnected, myFrontendProviderIndex, claims.map((c) => c.starknetAddress).join(",")]);

  const rows = computePayouts(claims).map((r) => ({
    ...r,
    registered: recipReg[r.claim.starknetAddress] === true,
  }));
  const payable = rows.filter((r) => r.payable && r.registered);
  const tooSmall = rows.filter((r) => !r.payable).length;
  const unregistered = rows.filter((r) => r.payable && !r.registered).length;
  const netTotal = payable.reduce((s, r) => s + r.net, 0);
  const networkMatches = isConnected && networkName?.toLowerCase() === network;
  const busy = status.kind === "sending" || status.kind === "confirming";
  const explorerTxUrl = (h: string) =>
    network === "mainnet" ? `https://voyager.online/tx/${h}` : `https://sepolia.voyager.online/tx/${h}`;

  const handlePayAll = async () => {
    if (!myWalletAccount || !connectedAddress || payable.length === 0) return;
    setStatus({ kind: "sending" });
    const actions: WALLET_API.STRK20_ACTION[] = payable.map((r) => {
      const amountWei = BigInt(Math.round(r.net * 1e18));
      return { type: "transfer", token: TOKEN, amount: num.toHex(amountWei), recipient: r.claim.starknetAddress };
    });

    let txH: string;
    try {
      const r = await myWalletAccount.strk20InvokeTransaction(actions);
      txH = r.transaction_hash;
    } catch (error: any) {
      const msg = error?.message ?? error?.toString?.() ?? String(error);
      setStatus({
        kind: "error",
        message: /NOT_REGISTERED/i.test(msg)
          ? "One of the recipients (or this wallet) isn't registered with the pool yet — every address in a batch needs a real Shield done from its own wallet first."
          : msg,
      });
      return;
    }

    setStatus({ kind: "confirming" });
    const provider = constants.myFrontendProviders[myFrontendProviderIndex];
    try {
      const txR: any = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      const exec = txR?.value?.execution_status ?? txR?.execution_status;
      if (exec === "REVERTED") {
        setStatus({ kind: "error", message: "Transaction reverted on-chain." });
        return;
      }
    } catch (error: any) {
      setStatus({ kind: "error", message: error?.message ?? "Could not confirm the transaction." });
      return;
    }

    setStatus({ kind: "ok", txHash: txH });
    // One tx settles every payable claim — mark them all paid against the hash.
    await Promise.allSettled(
      payable.map((r) =>
        fetch("/api/claims/pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoUrl: r.claim.repoUrl,
            network: r.claim.network,
            txHash: txH,
            payerAddress: connectedAddress,
          }),
        })
      )
    );
    onPaid();
  };

  if (status.kind === "ok") {
    return (
      <a href={explorerTxUrl(status.txHash)} target="_blank" rel="noreferrer" className="tag-clean inline-flex items-center gap-1">
        Paid {payable.length} privately ↗
      </a>
    );
  }

  return (
    <div aria-live="polite">
      {!networkMatches ? (
        <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
          Connected wallet is on {networkName ?? "an unsupported network"} — switch it to {network} to pay these.
        </p>
      ) : senderReg === false ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          This safe wallet isn&apos;t registered with the {network} pool yet — do one Shield from it first (Balances/Shield),
          then you can pay these out.
        </p>
      ) : checking && senderReg === null ? (
        <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400 flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Checking pool registrations…
        </p>
      ) : payable.length === 0 ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {unregistered > 0
            ? `${unregistered} recipient${unregistered === 1 ? " isn't" : "s aren't"} registered with the ${network} pool yet — each must do one Shield from its own wallet before it can receive a private payout.`
            : `The pending total on ${network} doesn't cover the ~${POOL_FEE_STRK} STRK pool fee yet — wait for more rescues before paying.`}
        </p>
      ) : (
        <>
          <button onClick={handlePayAll} disabled={busy} className="btn-primary text-sm px-5 py-2.5 disabled:opacity-50">
            {status.kind === "sending"
              ? "Confirm in your wallet…"
              : status.kind === "confirming"
              ? "Waiting for confirmation…"
              : `Pay ${payable.length} ${payable.length === 1 ? "claim" : "claims"} privately · ${netTotal.toFixed(4)} STRK`}
          </button>
          <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400 mt-2">
            One transaction · a single ~{POOL_FEE_STRK} STRK pool fee split across recipients (deducted from each payout).
            {unregistered > 0 && ` ${unregistered} recipient(s) not registered — skipped.`}
            {tooSmall > 0 && ` ${tooSmall} claim(s) too small to cover their fee share — left pending.`}
          </p>
        </>
      )}
      {status.kind === "error" && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{status.message}</p>}
    </div>
  );
}
