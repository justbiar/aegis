// Shared network config — Sepolia + mainnet, one Alchemy key covering both
// subdomains. Pulled out of scan.ts so rescue.ts can import it without a
// circular scan.ts <-> rescue.ts dependency.
export type Network = "mainnet" | "sepolia";

export const RPC_URL: Record<Network, string | null> = {
  mainnet: process.env.NEXT_PUBLIC_PROVIDER_URL
    ? `https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/${process.env.NEXT_PUBLIC_PROVIDER_URL}`
    : null,
  sepolia: process.env.NEXT_PUBLIC_PROVIDER_URL
    ? `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/${process.env.NEXT_PUBLIC_PROVIDER_URL}`
    : null,
};

export const SAFE_WALLET: Record<Network, string | null> = {
  mainnet: process.env.SAFE_WALLET_ADDRESS_MAINNET ?? null,
  sepolia: process.env.SAFE_WALLET_ADDRESS ?? null,
};

// Same contract address on both networks — STRK and ETH were declared with
// the same class + salt on mainnet and Sepolia.
export const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const ETH_TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
