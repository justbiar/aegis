import { hash } from "starknet";
import { deriveCandidateAddresses } from "./deriveAddress";

// Read-only secret scanning: fetches a small set of known config file names
// from a repo's default branch via the raw.githubusercontent.com CDN (no
// GitHub API calls, so no rate-limit pressure), flags anything that looks
// like a private key or an API key, then verifies whether it actually
// matters — a testnet balance check for private keys, a live liveness
// check for API keys. Nothing here ever moves funds or uses a key for
// anything beyond that one read-only check.

const SENSITIVE_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "hardhat.config.js",
  "hardhat.config.ts",
  "foundry.toml",
  "test-leak.env",
];

const CANDIDATE_BRANCHES = ["main", "master"];

// Well-known dev/test keys that must never be flagged as a real leak.
const KNOWN_TEST_KEYS = new Set([
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365",
]);

// Sepolia testnet only — this checks exposure, never mainnet. Free public
// Starknet RPCs (Blast, Lava, ...) have proven unreliable, so this reuses
// the same Alchemy provider the wallet panel already needs (NEXT_PUBLIC_PROVIDER_URL
// in .env.local).
const SEPOLIA_RPC = process.env.NEXT_PUBLIC_PROVIDER_URL
  ? `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/${process.env.NEXT_PUBLIC_PROVIDER_URL}`
  : null;
const STRK_SEPOLIA = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH_SEPOLIA = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

export interface ScanFinding {
  file: string;
  kind: "private_key" | "github_token" | "alchemy_key";
  masked: string;
  severity: "info" | "warning";
  detail: string;
}

export interface ScanResult {
  repoUrl: string;
  status: "clean" | "info" | "leak" | "error";
  findings: ScanFinding[];
  error?: string;
}

function shannonEntropy(s: string): number {
  const freq: Record<string, number> = {};
  for (const c of s) freq[c] = (freq[c] ?? 0) + 1;
  let entropy = 0;
  for (const c in freq) {
    const p = freq[c] / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function mask(secret: string): string {
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

function findPrivateKeys(content: string): string[] {
  const found = new Set<string>();
  const hexPattern = /0x[0-9a-fA-F]{32,64}\b/g;
  let m: RegExpExecArray | null;
  while ((m = hexPattern.exec(content))) {
    const candidate = m[0];
    if (KNOWN_TEST_KEYS.has(candidate.toLowerCase())) continue;
    if (shannonEntropy(candidate) < 2.5) continue;
    found.add(candidate);
  }
  return Array.from(found);
}

// A private key on its own can't be turned into a Starknet address without
// knowing which account contract deployed it. Real .env leaks usually pair
// the key with the address in the same file, so we use that when present
// rather than guessing.
function findPairedAddress(content: string): string | null {
  const m = content.match(
    /(?:ACCOUNT|DEPLOYER|WALLET)_ADDRESS\s*=\s*['"]?(0x[0-9a-fA-F]{1,64})['"]?/i
  );
  return m ? m[1] : null;
}

function findGithubTokens(content: string): string[] {
  const m = content.match(/gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}/g);
  return m ? Array.from(new Set(m)) : [];
}

// Alchemy keys are opaque ~32-char strings — only trust them near a variable
// name or URL that says so, otherwise this pattern is far too broad.
function findAlchemyKeys(content: string): string[] {
  const found = new Set<string>();
  const nearVar = /(?:ALCHEMY|PROVIDER_URL|RPC_KEY)\w*\s*=\s*['"]?([A-Za-z0-9_-]{32})\b/gi;
  const nearUrl = /alchemy\.com\/[^\s'"]*\/([A-Za-z0-9_-]{32})\b/gi;
  for (const re of [nearVar, nearUrl]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) found.add(m[1]);
  }
  return Array.from(found);
}

async function rpcBalanceOf(tokenAddress: string, accountAddress: string): Promise<bigint> {
  if (!SEPOLIA_RPC) throw new Error("NEXT_PUBLIC_PROVIDER_URL not set in .env.local");
  const res = await fetch(SEPOLIA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "starknet_call",
      params: {
        request: {
          contract_address: tokenAddress,
          entry_point_selector: hash.getSelectorFromName("balanceOf"),
          calldata: [accountAddress],
        },
        block_id: "latest",
      },
      id: 1,
    }),
  });
  const data = await res.json();
  const low = data?.result?.[0];
  if (!low) return 0n;
  return BigInt(low);
}

interface FundsCheck {
  detail: string;
  fundedAddress: string | null;
}

async function addressBalances(accountAddress: string): Promise<{ strk: bigint; eth: bigint }> {
  try {
    const [strk, eth] = await Promise.all([
      rpcBalanceOf(STRK_SEPOLIA, accountAddress),
      rpcBalanceOf(ETH_SEPOLIA, accountAddress),
    ]);
    return { strk, eth };
  } catch {
    return { strk: 0n, eth: 0n };
  }
}

// If the file names the account address, use it — that's certain. Otherwise
// derive candidate addresses from the key itself and check each on-chain;
// this is what makes the scanner not depend on someone handing it the
// address, at the cost of only covering the account types we know how to
// derive (see deriveAddress.ts).
async function checkTestnetFunds(pairedAddress: string | null, privateKey: string): Promise<FundsCheck> {
  if (!SEPOLIA_RPC) {
    return { detail: "Key found — set NEXT_PUBLIC_PROVIDER_URL to check testnet balance", fundedAddress: null };
  }
  const candidates = pairedAddress ? [pairedAddress] : deriveCandidateAddresses(privateKey);

  for (const addr of candidates) {
    const { strk, eth } = await addressBalances(addr);
    if (strk > 0n || eth > 0n) {
      const parts: string[] = [];
      if (strk > 0n) parts.push(`${Number(strk) / 1e18} STRK`);
      if (eth > 0n) parts.push(`${Number(eth) / 1e18} ETH`);
      return { detail: `Sepolia balance at ${addr.slice(0, 10)}…: ${parts.join(", ")}`, fundedAddress: addr };
    }
  }

  if (pairedAddress) return { detail: "No testnet funds found", fundedAddress: null };
  if (candidates.length === 0) {
    return { detail: "Key found — could not derive a candidate address", fundedAddress: null };
  }
  return {
    detail: `No funds found across ${candidates.length} derived candidate address(es)`,
    fundedAddress: null,
  };
}

async function checkGithubTokenLive(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.github.com/rate_limit", {
      headers: { Authorization: `token ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function checkAlchemyKeyLive(key: string): Promise<boolean> {
  try {
    const res = await fetch(`https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "starknet_chainId", params: [], id: 1 }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !data.error;
  } catch {
    return false;
  }
}

function repoPath(repoUrl: string): string | null {
  try {
    const u = new URL(repoUrl);
    if (u.hostname !== "github.com") return null;
    const [owner, repo] = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (!owner || !repo) return null;
    return `${owner}/${repo}`;
  } catch {
    return null;
  }
}

async function fetchRaw(path: string, file: string): Promise<string | null> {
  for (const branch of CANDIDATE_BRANCHES) {
    const url = `https://raw.githubusercontent.com/${path}/${branch}/${file}`;
    try {
      const res = await fetch(url);
      if (res.ok) return res.text();
    } catch {
      // network hiccup on this branch guess — try the next one
    }
  }
  return null;
}

async function scanFile(file: string, content: string): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const pairedAddress = findPairedAddress(content);

  for (const key of findPrivateKeys(content)) {
    const result = await checkTestnetFunds(pairedAddress, key);
    findings.push({
      file,
      kind: "private_key",
      masked: mask(key),
      severity: result.fundedAddress ? "warning" : "info",
      detail: result.detail,
    });
  }

  for (const token of findGithubTokens(content)) {
    const live = await checkGithubTokenLive(token);
    findings.push({
      file,
      kind: "github_token",
      masked: mask(token),
      severity: live ? "warning" : "info",
      detail: live ? "Token is live" : "Token is inactive or revoked",
    });
  }

  for (const key of findAlchemyKeys(content)) {
    const live = await checkAlchemyKeyLive(key);
    findings.push({
      file,
      kind: "alchemy_key",
      masked: mask(key),
      severity: live ? "warning" : "info",
      detail: live ? "Key is live" : "Key is inactive or invalid",
    });
  }

  return findings;
}

export async function scanRepo(repoUrl: string): Promise<ScanResult> {
  const path = repoPath(repoUrl);
  if (!path) {
    return { repoUrl, status: "error", findings: [], error: "Not a github.com repo URL" };
  }

  const findings: ScanFinding[] = [];
  try {
    for (const file of SENSITIVE_FILES) {
      const content = await fetchRaw(path, file);
      if (!content) continue;
      findings.push(...(await scanFile(file, content)));
    }
    const status = findings.length === 0
      ? "clean"
      : findings.some((f) => f.severity === "warning")
        ? "leak"
        : "info";
    return { repoUrl, status, findings };
  } catch (err: any) {
    return { repoUrl, status: "error", findings: [], error: err?.message ?? "Scan failed" };
  }
}
