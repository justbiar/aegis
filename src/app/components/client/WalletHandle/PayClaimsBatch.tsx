"use client";

import { useState } from "react";
import { num } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import * as constants from "@/utils/constants";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";

const TOKEN = constants.addrSTRK;

// Flat pool fee per apply_actions call (see strk20-hackathon issue #156). It's
// charged once per call regardless of how many transfers are inside, which is
// the whole reason batching pays off.
const POOL_FEE_STRK = 6;

interface BatchClaim {
  repoUrl: string;
  network: "mainnet" | "sepolia";
  amount: number;
  tipPercent: number;
  starknetAddress: string;
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

// Pays every pending claim on one network in a SINGLE private apply_actions
// call, so the flat pool fee is paid once instead of once per claim. Same
// wallet store / confirmation flow as PayClaimInline, just with an actions
// array of N transfers instead of one.
export default function PayClaimsBatch({ claims, network, onPaid }: Props) {
  const myWalletAccount = useStoreWallet((s) => s.myWalletAccount);
  const connectedAddress = useStoreWallet((s) => s.address);
  const isConnected = useStoreWallet((s) => s.isConnected);
  const myFrontendProviderIndex = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const networkName = constants.Strk20Networks[myFrontendProviderIndex];

  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const netTotal = claims.reduce((s, c) => s + c.amount * (1 - c.tipPercent / 100), 0);
  const networkMatches = isConnected && networkName?.toLowerCase() === network;
  const busy = status.kind === "sending" || status.kind === "confirming";
  const explorerTxUrl = (h: string) =>
    network === "mainnet" ? `https://voyager.online/tx/${h}` : `https://sepolia.voyager.online/tx/${h}`;

  const handlePayAll = async () => {
    if (!myWalletAccount || !connectedAddress || claims.length === 0) return;
    setStatus({ kind: "sending" });
    const actions: WALLET_API.STRK20_ACTION[] = claims.map((c) => {
      const netAmount = c.amount * (1 - c.tipPercent / 100);
      const amountWei = BigInt(Math.round(netAmount * 1e18));
      return { type: "transfer", token: TOKEN, amount: num.toHex(amountWei), recipient: c.starknetAddress };
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
    // One tx settles every claim — mark them all paid against the same hash.
    await Promise.allSettled(
      claims.map((c) =>
        fetch("/api/claims/pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoUrl: c.repoUrl, network: c.network, txHash: txH, payerAddress: connectedAddress }),
        })
      )
    );
    onPaid();
  };

  if (status.kind === "ok") {
    return (
      <a href={explorerTxUrl(status.txHash)} target="_blank" rel="noreferrer" className="tag-clean inline-flex items-center gap-1">
        Paid {claims.length} privately ↗
      </a>
    );
  }

  return (
    <div aria-live="polite">
      {!networkMatches ? (
        <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
          Connected wallet is on {networkName ?? "an unsupported network"} — switch it to {network} to pay these.
        </p>
      ) : (
        <>
          <button onClick={handlePayAll} disabled={busy} className="btn-primary text-sm px-5 py-2.5 disabled:opacity-50">
            {status.kind === "sending"
              ? "Confirm in your wallet…"
              : status.kind === "confirming"
              ? "Waiting for confirmation…"
              : `Pay ${claims.length} ${claims.length === 1 ? "claim" : "claims"} privately · ${netTotal.toFixed(4)} STRK`}
          </button>
          <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400 mt-2">
            One transaction, one ~{POOL_FEE_STRK} STRK pool fee
            {claims.length > 1 ? ` — instead of ${claims.length} separate ${POOL_FEE_STRK} STRK fees.` : "."}
          </p>
        </>
      )}
      {status.kind === "error" && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{status.message}</p>}
    </div>
  );
}
