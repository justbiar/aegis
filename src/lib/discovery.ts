// Finds Starknet repositories to watch, beyond the sprint registry.
//
// GitHub's search API caps any single query at 1000 results, and there are
// ~5k Starknet repos, so the ecosystem is covered by a fixed list of queries
// sliced by star count and topic. Unauthenticated search is limited to 10
// calls a minute, which is well under what one serverless invocation can spend
// — so discovery is incremental: each run walks a few pages, merges what it
// finds into a KV set, and leaves a cursor for the next run to continue from.
//
// The set is the work queue that ./scan sweeps through; see the sweep route
// for why everything discovered this way is scanned detect-only.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const REPOS_KEY = "aegis:repos:discovered";
const CURSOR_KEY = "aegis:repos:discovery-cursor";
const SCAN_CURSOR_KEY = "aegis:repos:scan-cursor";

// Each query is capped at 1000 results by GitHub, so they are sliced to stay
// under that and still reach the long tail of small repos.
const QUERIES = [
  "starknet stars:>=50",
  "starknet stars:10..49",
  "starknet stars:3..9",
  "starknet stars:1..2",
  "topic:starknet",
  "topic:cairo-lang",
  "starknet.js in:name,description,readme",
  "cairo starknet contract in:name,description",
];

const PER_PAGE = 100;
const MAX_PAGE = 10; // 1000-result cap / PER_PAGE

export const discoveryAvailable = Boolean(KV_URL && KV_TOKEN);

async function kv(path: string, init?: RequestInit): Promise<any> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${KV_TOKEN}`, ...(init?.headers ?? {}) },
    });
    return await res.json();
  } catch {
    return null;
  }
}

interface Cursor {
  query: number;
  page: number;
}

async function readCursor(): Promise<Cursor> {
  const data = await kv(`get/${CURSOR_KEY}`);
  try {
    const parsed = JSON.parse(data?.result ?? "");
    if (typeof parsed?.query === "number" && typeof parsed?.page === "number") return parsed;
  } catch {
    /* no cursor yet */
  }
  return { query: 0, page: 1 };
}

async function writeCursor(c: Cursor): Promise<void> {
  await kv(`set/${CURSOR_KEY}/${encodeURIComponent(JSON.stringify(c))}`);
}

// GitHub's own token is optional: without one the search limit is 10/min,
// which is why a run only walks a few pages. With GITHUB_TOKEN set the same
// code simply gets further per run.
function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aegis-scanner",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

interface SearchPage {
  urls: string[];
  // Distinguishing these matters: a genuinely short page means the query is
  // exhausted and the cursor should move on, whereas a throttled or failed
  // request means we learned nothing and the cursor must stay put. Treating
  // the second like the first silently skips whole queries — and the repos
  // in them are then never discovered at all.
  exhausted: boolean;
  limited: boolean;
  remaining: number | null;
}

async function searchPage(q: string, page: number): Promise<SearchPage> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: githubHeaders() });
  } catch {
    return { urls: [], exhausted: false, limited: true, remaining: null };
  }

  const remainingHeader = res.headers.get("x-ratelimit-remaining");
  const remaining = remainingHeader === null ? null : Number(remainingHeader);

  // GitHub signals search throttling with 403/429 (and 422 once a query walks
  // past the 1000-result cap, which is a real end-of-query).
  if (res.status === 403 || res.status === 429) {
    return { urls: [], exhausted: false, limited: true, remaining };
  }
  if (res.status === 422) {
    return { urls: [], exhausted: true, limited: false, remaining };
  }
  if (!res.ok) {
    return { urls: [], exhausted: false, limited: true, remaining };
  }

  const data = await res.json();
  const items: any[] = data?.items ?? [];
  const urls = items.map((r) => r?.html_url).filter((u): u is string => typeof u === "string");
  return { urls, exhausted: urls.length < PER_PAGE, limited: false, remaining };
}

export interface DiscoveryRun {
  pagesWalked: number;
  found: number;
  added: number;
  total: number;
  cursor: Cursor;
  // True when the run stopped early because GitHub throttled us. The cursor is
  // left where it was, so the next run resumes on the same page.
  rateLimited: boolean;
  remaining: number | null;
}

// Walks up to `pages` search pages from wherever the last run stopped, adding
// new repo URLs to the queue. Unauthenticated search allows 10 requests a
// minute, so a run stays well under that and simply continues next time —
// discovery is meant to be slow and steady, not exhaustive in one go.
export async function discoverStarknetRepos(pages = 6): Promise<DiscoveryRun | null> {
  if (!discoveryAvailable) return null;

  const cursor = await readCursor();
  let { query, page } = cursor;
  let found = 0;
  let added = 0;
  let walked = 0;
  let rateLimited = false;
  let remaining: number | null = null;

  for (let i = 0; i < pages; i++) {
    const res = await searchPage(QUERIES[query], page);
    remaining = res.remaining ?? remaining;

    if (res.limited) {
      // Stop without advancing: this page still needs to be read.
      rateLimited = true;
      break;
    }

    walked++;
    found += res.urls.length;

    if (res.urls.length > 0) {
      // SADD returns how many members were actually new.
      const args = res.urls.map((u) => encodeURIComponent(u)).join("/");
      const added_ = await kv(`sadd/${REPOS_KEY}/${args}`);
      added += Number(added_?.result ?? 0);
    }

    if (res.exhausted || page >= MAX_PAGE) {
      query = (query + 1) % QUERIES.length;
      page = 1;
    } else {
      page++;
    }

    // Leave headroom against the search quota rather than sprinting into a 403.
    if (remaining !== null && remaining <= 1) {
      rateLimited = true;
      break;
    }
  }

  await writeCursor({ query, page });
  const count = await kv(`scard/${REPOS_KEY}`);
  return {
    pagesWalked: walked,
    found,
    added,
    total: Number(count?.result ?? 0),
    cursor: { query, page },
    rateLimited,
    remaining,
  };
}

export async function discoveredCount(): Promise<number> {
  const res = await kv(`scard/${REPOS_KEY}`);
  return Number(res?.result ?? 0);
}

// The sweep reads the whole set once and then walks it in slices, so a repo's
// position stays stable between runs even as new ones are discovered.
export async function nextSweepBatch(size: number): Promise<{ repos: string[]; offset: number; total: number }> {
  const all = await kv(`smembers/${REPOS_KEY}`);
  const repos: string[] = all?.result ?? [];
  if (repos.length === 0) return { repos: [], offset: 0, total: 0 };

  repos.sort();
  const cur = await kv(`get/${SCAN_CURSOR_KEY}`);
  const offset = Math.max(0, Number(cur?.result ?? 0)) % repos.length;
  const batch = repos.slice(offset, offset + size);
  // Wrap around so a batch is always full while the set is larger than `size`.
  if (batch.length < size && repos.length > size) batch.push(...repos.slice(0, size - batch.length));

  const nextOffset = (offset + batch.length) % repos.length;
  await kv(`set/${SCAN_CURSOR_KEY}/${nextOffset}`);
  return { repos: batch, offset, total: repos.length };
}
