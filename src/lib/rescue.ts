import { Account, RpcProvider, CallData, uint256 } from "starknet";
import type { AccountCandidate } from "./deriveAddress";
import { RPC_URL, STRK_TOKEN, type Network } from "./networks";

// Left in the account to cover its own deploy + transfer fees. Generous on
// Sepolia since it's testnet STRK; mainnet gas is real money, so the buffer
// there is smaller — tune SAFE_WALLET_ADDRESS_MAINNET's own balance if fees
// spike beyond this.
const FEE_BUFFER: Record<Network, bigint> = {
  sepolia: 5n * 10n ** 18n, // 5 STRK
  mainnet: 2n * 10n ** 18n, // 2 STRK
};

export interface RescueResult {
  rescued: boolean;
  deployTxHash?: string;
  transferTxHash?: string;
  amount?: string;
  amountStrk?: number;
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

async function strkBalance(provider: RpcProvider, address: string): Promise<bigint> {
  const res = await provider.callContract({
    contractAddress: STRK_TOKEN,
    entrypoint: "balanceOf",
    calldata: [address],
  });
  return BigInt(res[0] ?? "0x0");
}

// Sweeps STRK from a leaked, funded account to the safe address. Deploys the
// account first if it's still counterfactual (deploy fee comes out of its
// own balance, since it's already funded).
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

    const balance = await strkBalance(provider, candidate.address);
    const feeBuffer = FEE_BUFFER[network];
    if (balance <= feeBuffer) {
      return { rescued: false, deployTxHash, error: "Balance too small to cover fees" };
    }
    const amount = balance - feeBuffer;

    const { transaction_hash } = await account.execute({
      contractAddress: STRK_TOKEN,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: safeAddress,
        amount: uint256.bnToUint256(amount),
      }),
    });

    return {
      rescued: true,
      deployTxHash,
      transferTxHash: transaction_hash,
      amount: `${Number(amount) / 1e18} STRK`,
      amountStrk: Number(amount) / 1e18,
    };
  } catch (err: any) {
    return { rescued: false, deployTxHash, error: err?.message ?? "Rescue failed" };
  }
}
