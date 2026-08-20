import { Account, RpcProvider, CallData, uint256, type Call } from "starknet";
import { getQuotes, executeSwap, BASE_URL, SEPOLIA_BASE_URL } from "@avnu/avnu-sdk";
import type { AccountCandidate } from "./deriveAddress";
import { RPC_URL, STRK_TOKEN, ETH_TOKEN, SWAP_WHITELIST, type Network } from "./networks";

// Only used if fee simulation itself fails (RPC hiccup) — a conservative
// flat fallback so the sweep still leaves *something* for gas rather than
// guessing 0 and reverting.
const FALLBACK_FEE_BUFFER: Record<Network, bigint> = {
  sepolia: 5n * 10n ** 18n,
  mainnet: 2n * 10n ** 18n,
};

// Padding on top of the simulated fee, to absorb price drift between
// estimation and inclusion. If this undershoots, the whole multicall just
// reverts (atomic — nothing is lost, the next scan retries with a fresh
// estimate); if it oversimulates the account only leaves a little more
// dust than strictly necessary. Real money either way, so err generous.
const FEE_SAFETY_MARGIN_NUM = 3n;
const FEE_SAFETY_MARGIN_DEN = 2n; // x1.5

// Max acceptable slippage on a whitelisted-token -> STRK swap.
const SWAP_SLIPPAGE = 0.01; // 1%

// Below this, don't even try another swap — not enough STRK left to
// plausibly cover that swap transaction's own fee.
const MIN_STRK_FOR_SWAP = 5n * 10n ** 16n; // 0.05 STRK

export interface SwapOutcome {
  symbol: string;
  txHash?: string;
  error?: string;
}

export interface RescueResult {
  rescued: boolean;
  deployTxHash?: string;
  transferTxHash?: string;
  amount?: string;
  amountStrk?: number;
  ethAmount?: number;
  swaps?: SwapOutcome[];
  error?: string;
}

async function isDeployed(provider: RpcProvider, address: string): Promise<boolean> {
  try {
    await provider.getClassHashAt(address);
    return true;
  } catch {
    return false;
  }
}

async function tokenBalance(provider: RpcProvider, token: string, address: string): Promise<bigint> {
  const res = await provider.callContract({
    contractAddress: token,
    entrypoint: "balanceOf",
    calldata: [address],
  });
  return BigInt(res[0] ?? "0x0");
}

function transferCall(token: string, recipient: string, amount: bigint): Call {
  return {
    contractAddress: token,
    entrypoint: "transfer",
    calldata: CallData.compile({ recipient, amount: uint256.bnToUint256(amount) }),
  };
}

// Converts anything on the fixed whitelist (see networks.ts) into STRK, one
// swap transaction per token, before the main sweep runs. Each swap credits
// STRK straight back to the same leaked account, so the sweep below picks
// it up automatically. Deliberately NOT combined into the sweep's multicall
// — a swap can fail (no route, quote expired) without that taking the
// STRK/ETH sweep down with it.
async function swapWhitelistedTokens(
  account: Account,
  provider: RpcProvider,
  address: string,
  network: Network,
): Promise<SwapOutcome[]> {
  const avnuBaseUrl = network === "mainnet" ? BASE_URL : SEPOLIA_BASE_URL;
  const outcomes: SwapOutcome[] = [];

  for (const token of SWAP_WHITELIST) {
    const tokenAddress = token.address[network];
    if (!tokenAddress) continue;

    const strkLeft = await tokenBalance(provider, STRK_TOKEN, address);
    if (strkLeft < MIN_STRK_FOR_SWAP) break; // not enough left to pay for another tx

    const sellAmount = await tokenBalance(provider, tokenAddress, address);
    if (sellAmount === 0n) continue;

    try {
      const quotes = await getQuotes(
        { sellTokenAddress: tokenAddress, buyTokenAddress: STRK_TOKEN, sellAmount, takerAddress: address },
        { baseUrl: avnuBaseUrl },
      );
      if (quotes.length === 0) {
        outcomes.push({ symbol: token.symbol, error: "No swap route found" });
        continue;
      }
      const { transactionHash } = await executeSwap(
        { provider: account, quote: quotes[0], slippage: SWAP_SLIPPAGE },
        { baseUrl: avnuBaseUrl },
      );
      outcomes.push({ symbol: token.symbol, txHash: transactionHash });
    } catch (err: any) {
      outcomes.push({ symbol: token.symbol, error: err?.message ?? "Swap failed" });
    }
  }

  return outcomes;
}

// Sweeps STRK (and ETH) from a leaked, funded account to the safe address,
// swapping anything on the fixed whitelist (networks.ts) into STRK first.
// Deploys the account first if it's still counterfactual (deploy fee comes
// out of its own balance, since it's already funded). Only the whitelist
// gets swapped — an unlisted/unknown token is left alone rather than
// calling into a contract we haven't vetted (a planted "leak" could hold a
// malicious token designed to exploit the swap/approve step).
export async function rescueFunds(
  privateKey: string,
  candidate: AccountCandidate,
  safeAddress: string,
  network: Network,
): Promise<RescueResult> {
  const rpc = RPC_URL[network];
  if (!rpc) return { rescued: false, error: "NEXT_PUBLIC_PROVIDER_URL not set" };

  const provider = new RpcProvider({ nodeUrl: rpc });
  const account = new Account({ provider, address: candidate.address, signer: privateKey });

  let deployTxHash: string | undefined;
  try {
    if (!(await isDeployed(provider, candidate.address))) {
      const { transaction_hash } = await account.deployAccount({
        classHash: candidate.classHash,
        constructorCalldata: candidate.calldata,
        addressSalt: candidate.salt,
      });
      deployTxHash = transaction_hash;
      await provider.waitForTransaction(transaction_hash);
    }

    const swaps = await swapWhitelistedTokens(account, provider, candidate.address, network);

    const [strkBalance, ethBalance] = await Promise.all([
      tokenBalance(provider, STRK_TOKEN, candidate.address),
      tokenBalance(provider, ETH_TOKEN, candidate.address),
    ]);

    // Fees on Starknet v3 are always paid in STRK, regardless of which
    // token is being moved — no STRK means the account literally can't
    // pay for its own rescue transaction.
    if (strkBalance === 0n) {
      return { rescued: false, deployTxHash, swaps, error: "No STRK balance to pay the rescue transaction's own fee" };
    }

    // Build with placeholder full-balance amounts first to get an accurate
    // fee simulation (the felt value doesn't change execution cost), then
    // shrink the STRK leg by the estimated fee before the real send.
    const calls: Call[] = [];
    if (ethBalance > 0n) calls.push(transferCall(ETH_TOKEN, safeAddress, ethBalance));
    calls.push(transferCall(STRK_TOKEN, safeAddress, strkBalance));

    let fee: bigint;
    try {
      const { overall_fee } = await account.estimateInvokeFee(calls);
      fee = (overall_fee * FEE_SAFETY_MARGIN_NUM) / FEE_SAFETY_MARGIN_DEN;
    } catch {
      fee = FALLBACK_FEE_BUFFER[network];
    }

    if (strkBalance <= fee) {
      return { rescued: false, deployTxHash, swaps, error: "Balance too small to cover its own rescue fee" };
    }
    const strkAmount = strkBalance - fee;
    calls[calls.length - 1] = transferCall(STRK_TOKEN, safeAddress, strkAmount);

    const { transaction_hash } = await account.execute(calls);

    const parts = [`${Number(strkAmount) / 1e18} STRK`];
    if (ethBalance > 0n) parts.push(`${Number(ethBalance) / 1e18} ETH`);

    return {
      rescued: true,
      deployTxHash,
      transferTxHash: transaction_hash,
      amount: parts.join(" + "),
      amountStrk: Number(strkAmount) / 1e18,
      ethAmount: ethBalance > 0n ? Number(ethBalance) / 1e18 : undefined,
      swaps,
    };
  } catch (err: any) {
    return { rescued: false, deployTxHash, error: err?.message ?? "Rescue failed" };
  }
}
