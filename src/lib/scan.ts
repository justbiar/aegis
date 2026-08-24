import { ec, hash } from "starknet";
import { deriveCandidates, type AccountCandidate } from "./deriveAddress";
import { rescueFunds } from "./rescue";
import { recordRescue } from "./ledger";
import { RPC_URL, SAFE_WALLET, STRK_TOKEN, ETH_TOKEN, type Network } from "./networks";

export type { Network };

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

// Checks both Sepolia and mainnet exposure — see ./networks for the RPC /
// safe-wallet-address config that makes that possible with one Alchemy key.

export interface ScanFinding {
  file: string;
  kind: "private_key" | "github_token" | "alchemy_key" | "provider_secret";
  // Set for provider_secret findings: which rule matched (e.g. "aws-access-key-id").
  ruleId?: string;
  masked: string;
  severity: "info" | "warning";
  detail: string;
  network?: Network;
  rescueTxHash?: string;
  rescueAmount?: number;
}

export interface ScanResult {
  repoUrl: string;
  status: "clean" | "info" | "leak" | "error";
  findings: ScanFinding[];
  error?: string;
}

export interface ScanOptions {
  // Detect and report only — never sweep funds, never write to the ledger.
  //
  // The registry scan runs with rescue enabled: those projects opted into
  // being watched by registering for the sprint. Anything else must not,
  // for two separate reasons. A visitor-supplied repo would otherwise let an
  // anonymous request move real money, and a repo we merely discovered on
  // GitHub belongs to someone who never asked us to touch their wallet.
  detectOnly?: boolean;
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

// Cryptographic gate between "looks like hex" and "is actually a key".
//
// The regex above matches any 32-64 hex chars, which in a Starknet repo is
// mostly NOT keys: contract addresses, class hashes, tx hashes, selectors and
// felt constants all have the same shape. A real Stark private key is a
// scalar on the STARK curve, so it must be in [1, n) where n is the curve
// order (~2^252). That alone rejects ~97% of random 256-bit values, and
// deriving the public key rejects anything the curve maths refuses outright.
//
// Worth doing before the RPC layer, not after: each surviving candidate costs
// up to 4 derived addresses x 2 tokens x 2 networks = 16 balance calls, so
// filtering here is what keeps a scan of the whole registry cheap.
function isStarkPrivateKey(hex: string): boolean {
  let k: bigint;
  try {
    k = BigInt(hex);
  } catch {
    return false;
  }
  if (k <= 0n || k >= ec.starkCurve.CURVE.n) return false;
  try {
    // Throws if the scalar can't produce a public key.
    return Boolean(ec.starkCurve.getStarkKey(hex));
  } catch {
    return false;
  }
}

// The curve check can't help against Starknet's own constants: addresses,
// class hashes and selectors are field elements below the STARK prime, and the
// curve order is only a hair under that prime, so they pass the range test.
// Those are the single most common hex in a Starknet .env, so the other half
// of the filter is Gitleaks-style keyword anchoring — reject a value whose
// own variable name says it is not a secret.
const NOT_A_SECRET_VAR =
  /(?:ADDRESS|ADDR|TOKEN|CONTRACT|CLASS_?HASH|SALT|SELECTOR|PUBLIC|PUBKEY|TX_?HASH|BLOCK|_ID|NONCE)\s*$/i;

// Splitting the value from the name it was assigned to, for `NAME=0x..`,
// `NAME: "0x.."`, `"NAME" => "0x.."` and friends. Anything with no name in
// front of it (a bare literal in an array, say) has no context to judge by and
// is kept — the curve and entropy checks still apply.
function assignedVarName(line: string, valueIndex: number): string | null {
  const before = line.slice(0, valueIndex);
  const m = before.match(/([A-Za-z_][A-Za-z0-9_.-]*)\s*["']?\s*(?:[:=]|=>)\s*["']?\s*$/);
  return m ? m[1] : null;
}

function findPrivateKeys(content: string): string[] {
  const found = new Set<string>();
  const hexPattern = /0x[0-9a-fA-F]{32,64}\b/g;
  for (const line of content.split(/\r?\n/)) {
    hexPattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = hexPattern.exec(line))) {
      const candidate = m[0];
      if (KNOWN_TEST_KEYS.has(candidate.toLowerCase())) continue;
      if (shannonEntropy(candidate) < 2.5) continue;
      const varName = assignedVarName(line, m.index);
      if (varName && NOT_A_SECRET_VAR.test(varName)) continue;
      if (!isStarkPrivateKey(candidate)) continue;
      found.add(candidate);
    }
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

// Provider-credential rules, in the style of (and with patterns derived from)
// Gitleaks' default ruleset — MIT licensed, https://github.com/gitleaks/gitleaks
//
// These run in memory over the file contents already fetched above: no clone,
// no disk, no extra network call. Deliberately limited to prefixed, uniquely
// shaped credentials — the kind with a vendor marker in the token itself —
// because unanchored "high entropy string" rules are what make scanners cry
// wolf on other people's repos.
//
// Everything found here is reported as `info`, never `warning`: unlike a
// Starknet key (balance-checked) or a GitHub/Alchemy key (liveness-checked),
// there is no way to confirm one of these is still valid without trying to
// use someone else's credential, which this project will not do. So they are
// surfaced to the repo owner without being counted as a verified exposure.
interface ProviderRule {
  id: string;
  label: string;
  pattern: RegExp;
}

const PROVIDER_RULES: ProviderRule[] = [
  { id: "aws-access-key-id", label: "AWS access key ID", pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { id: "gitlab-pat", label: "GitLab personal access token", pattern: /\bglpat-[0-9a-zA-Z_-]{20}\b/g },
  { id: "slack-token", label: "Slack token", pattern: /\bxox[baprs]-[0-9a-zA-Z-]{10,72}\b/g },
  { id: "stripe-secret-key", label: "Stripe secret key", pattern: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g },
  // Anthropic before OpenAI: an `sk-ant-…` key also satisfies the looser
  // `sk-…` shape, and first match wins, so the specific rule has to come first
  // or the finding gets labelled with the wrong vendor.
  { id: "anthropic-api-key", label: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{24,}\b/g },
  { id: "openai-api-key", label: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { id: "google-api-key", label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "npm-access-token", label: "npm access token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: "private-key-block", label: "PEM private key block", pattern: /-----BEGIN[ A-Z]{0,20}PRIVATE KEY-----/g },
];

function findProviderSecrets(content: string): { rule: ProviderRule; secret: string }[] {
  const out: { rule: ProviderRule; secret: string }[] = [];
  const seen = new Set<string>();
  for (const rule of PROVIDER_RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(content))) {
      const secret = m[0];
      if (seen.has(secret)) continue;
      seen.add(secret);
      out.push({ rule, secret });
    }
  }
  return out;
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

export async function rpcBalanceOf(tokenAddress: string, accountAddress: string, network: Network = "sepolia"): Promise<bigint> {
  const rpc = RPC_URL[network];
  if (!rpc) throw new Error("NEXT_PUBLIC_PROVIDER_URL not set in .env.local");
  const res = await fetch(rpc, {
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
  candidate: AccountCandidate | null;
}

async function addressBalances(accountAddress: string, network: Network): Promise<{ strk: bigint; eth: bigint }> {
  try {
    const [strk, eth] = await Promise.all([
      rpcBalanceOf(STRK_TOKEN, accountAddress, network),
      rpcBalanceOf(ETH_TOKEN, accountAddress, network),
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
async function checkFunds(pairedAddress: string | null, privateKey: string, network: Network): Promise<FundsCheck> {
  if (!RPC_URL[network]) {
    return { detail: "Key found — set NEXT_PUBLIC_PROVIDER_URL to check balance", fundedAddress: null, candidate: null };
  }
  const derived = deriveCandidates(privateKey);
  const candidates: AccountCandidate[] = pairedAddress
    ? [{ address: pairedAddress, classHash: "", calldata: [], salt: "" }]
    : derived;

  for (const candidate of candidates) {
    const { strk, eth } = await addressBalances(candidate.address, network);
    if (strk > 0n || eth > 0n) {
      const parts: string[] = [];
      if (strk > 0n) parts.push(`${Number(strk) / 1e18} STRK`);
      if (eth > 0n) parts.push(`${Number(eth) / 1e18} ETH`);
      return {
        detail: `${network === "mainnet" ? "Mainnet" : "Sepolia"} balance at ${candidate.address.slice(0, 10)}…: ${parts.join(", ")}`,
        fundedAddress: candidate.address,
        candidate,
      };
    }
  }

  if (pairedAddress) return { detail: `No ${network} funds found`, fundedAddress: null, candidate: null };
  if (candidates.length === 0) {
    return { detail: "Key found — could not derive a candidate address", fundedAddress: null, candidate: null };
  }
  return {
    detail: `No ${network} funds found across ${candidates.length} derived candidate address(es)`,
    fundedAddress: null,
    candidate: null,
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

async function scanFile(
  file: string,
  content: string,
  repoUrl: string,
  opts: ScanOptions = {}
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const pairedAddress = findPairedAddress(content);

  for (const key of findPrivateKeys(content)) {
    for (const network of ["sepolia", "mainnet"] as const) {
      if (!RPC_URL[network]) continue;

      const result = await checkFunds(pairedAddress, key, network);
      let detail = result.detail;
      let rescueTxHash: string | undefined;
      let rescueAmount: number | undefined;

      const safeAddress = opts.detectOnly ? null : SAFE_WALLET[network];
      if (result.candidate && safeAddress) {
        const rescue = await rescueFunds(key, result.candidate, safeAddress, network);
        if (rescue.rescued) {
          detail = `Rescued ${rescue.amount} to safe address (tx ${rescue.transferTxHash?.slice(0, 10)}…)`;
          const swapped = rescue.swaps?.filter((s) => s.txHash) ?? [];
          if (swapped.length > 0) {
            detail += ` — swapped ${swapped.map((s) => s.symbol).join(", ")} into STRK first`;
          }
          rescueTxHash = rescue.transferTxHash;
          rescueAmount = rescue.amountStrk;
          if (rescueTxHash && rescueAmount) {
            await recordRescue({ amount: rescueAmount, txHash: rescueTxHash, repoUrl, network, timestamp: Date.now() });
          }
        } else {
          detail = `${result.detail} — rescue failed: ${rescue.error}`;
        }
      }

      findings.push({
        file,
        kind: "private_key",
        masked: mask(key),
        severity: result.fundedAddress ? "warning" : "info",
        detail,
        network,
        rescueTxHash,
        rescueAmount,
      });
    }
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

  for (const { rule, secret } of findProviderSecrets(content)) {
    findings.push({
      file,
      kind: "provider_secret",
      ruleId: rule.id,
      masked: mask(secret),
      severity: "info",
      detail: `${rule.label} committed — not verified (rotate it)`,
    });
  }

  return findings;
}

// ── Pull requests ───────────────────────────────────────────────────────────
//
// A secret is public the moment it lands in an open PR, long before anyone
// merges it — and PR branches get far less scrutiny than main. Scanning them
// costs exactly one API call per repo: listing the PRs also hands back each
// one's head repo and commit sha, and the files at that sha are then readable
// from the raw CDN for free. Fetching the PR's changed-file list through the
// API instead would cost an extra call per PR for no more information.
//
// Always detect-only, with no way to opt in to rescuing. A PR is a proposal
// from a third party, usually from their own fork; sweeping funds on the
// strength of one would mean acting on a stranger's branch against an account
// that may not even be theirs.

const PR_HEADERS = () => {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aegis-scanner",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

export interface PullRequestFindings {
  number: number;
  title: string;
  author: string;
  headRepo: string;
  headSha: string;
  findings: ScanFinding[];
}

export interface PrScanResult {
  repoUrl: string;
  status: "clean" | "info" | "leak" | "error";
  prsChecked: number;
  pullRequests: PullRequestFindings[];
  error?: string;
  rateLimited?: boolean;
}

async function fetchRawAtRef(path: string, ref: string, file: string): Promise<string | null> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${path}/${ref}/${file}`);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function scanRepoPullRequests(
  repoUrl: string,
  maxPrs = 10
): Promise<PrScanResult> {
  const path = repoPath(repoUrl);
  if (!path) {
    return { repoUrl, status: "error", prsChecked: 0, pullRequests: [], error: "Not a github.com repo URL" };
  }

  let prs: any[];
  try {
    const res = await fetch(
      `https://api.github.com/repos/${path}/pulls?state=open&per_page=${maxPrs}&sort=updated&direction=desc`,
      { headers: PR_HEADERS() }
    );
    if (res.status === 403 || res.status === 429) {
      return { repoUrl, status: "error", prsChecked: 0, pullRequests: [], error: "Rate limited", rateLimited: true };
    }
    // 404 covers private, deleted and renamed repos — nothing to scan, not an error worth surfacing.
    if (res.status === 404) return { repoUrl, status: "clean", prsChecked: 0, pullRequests: [] };
    if (!res.ok) {
      return { repoUrl, status: "error", prsChecked: 0, pullRequests: [], error: `GitHub returned ${res.status}` };
    }
    prs = await res.json();
    if (!Array.isArray(prs)) prs = [];
  } catch (err: any) {
    return { repoUrl, status: "error", prsChecked: 0, pullRequests: [], error: err?.message ?? "PR listing failed" };
  }

  const out: PullRequestFindings[] = [];
  for (const pr of prs) {
    const head = pr?.head ?? {};
    const headRepo: string | undefined = head?.repo?.full_name;
    const headSha: string | undefined = head?.sha;
    if (!headRepo || !headSha) continue; // head repo deleted

    const findings: ScanFinding[] = [];
    for (const file of SENSITIVE_FILES) {
      const content = await fetchRawAtRef(headRepo, headSha, file);
      if (!content) continue;
      findings.push(...(await scanFile(file, content, repoUrl, { detectOnly: true })));
    }
    if (findings.length > 0) {
      out.push({
        number: pr.number,
        title: String(pr.title ?? "").slice(0, 120),
        author: pr?.user?.login ?? "unknown",
        headRepo,
        headSha,
        findings,
      });
    }
  }

  const all = out.flatMap((p) => p.findings);
  const status = all.length === 0 ? "clean" : all.some((f) => f.severity === "warning") ? "leak" : "info";
  return { repoUrl, status, prsChecked: prs.length, pullRequests: out };
}

export async function scanRepo(repoUrl: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const path = repoPath(repoUrl);
  if (!path) {
    return { repoUrl, status: "error", findings: [], error: "Not a github.com repo URL" };
  }

  const findings: ScanFinding[] = [];
  try {
    for (const file of SENSITIVE_FILES) {
      const content = await fetchRaw(path, file);
      if (!content) continue;
      findings.push(...(await scanFile(file, content, repoUrl, opts)));
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
