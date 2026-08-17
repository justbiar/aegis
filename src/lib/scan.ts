// Read-only secret scanning: fetches a small set of known config file names
// from a repo's default branch via the raw.githubusercontent.com CDN (no
// GitHub API calls, so no rate-limit pressure) and flags anything that looks
// like a live private key. Nothing here probes a balance or moves funds —
// this only detects and masks.

const SENSITIVE_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "hardhat.config.js",
  "hardhat.config.ts",
  "foundry.toml",
];

const CANDIDATE_BRANCHES = ["main", "master"];

// Well-known dev/test keys that must never be flagged as a real leak.
const KNOWN_TEST_KEYS = new Set([
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365",
]);

export interface ScanFinding {
  file: string;
  masked: string;
}

export interface ScanResult {
  repoUrl: string;
  status: "clean" | "leak" | "error";
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

function findKeysInContent(content: string): string[] {
  const found = new Set<string>();
  // 0x-prefixed hex, 32-64 chars — covers Starknet felt252 keys and EVM keys.
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
      for (const key of findKeysInContent(content)) {
        findings.push({ file, masked: mask(key) });
      }
    }
    return { repoUrl, status: findings.length > 0 ? "leak" : "clean", findings };
  } catch (err: any) {
    return { repoUrl, status: "error", findings: [], error: err?.message ?? "Scan failed" };
  }
}
