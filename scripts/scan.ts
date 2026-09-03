/* One registry scan, run from CI instead of from the web host.
 *
 * The scanner used to exist only as an HTTP endpoint, so every pass was
 * charged against the same CPU allowance that serves the site — and when that
 * allowance ran out the deployment was paused, which took the product offline
 * rather than merely slowing the scanning down. Nothing about a scan wants to
 * be a web request: it takes minutes, nobody waits for the response, and the
 * runner it needs is free on a public repository.
 *
 * Reads and writes the same KV the site reads, so the result shows up on the
 * site exactly as before.
 *
 *   npm run scan
 */

import { runRegistryScan } from "../src/lib/registryScan";
import { runHotScan } from "../src/lib/hotScan";

// `npm run scan -- --hot` runs the fast lane instead of a full pass.
const hotOnly = process.argv.includes("--hot");

const required = ["KV_REST_API_URL", "KV_REST_API_TOKEN", "NEXT_PUBLIC_PROVIDER_URL"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  // Without KV the scan runs and throws the result away; without an RPC it
  // can't tell a live key from a dead one. Either way it isn't worth the pass.
  console.error(`missing environment: ${missing.join(", ")}`);
  process.exit(1);
}

async function main() {
  const startedAt = Date.now();

  if (hotOnly) {
    const summary = await runHotScan();
    console.log(
      summary.idle
        ? "hot lane idle — nothing is known to be leaking"
        : `re-checked ${summary.scanned} known leaks — ${summary.rescued} rescued, ${summary.errors} errored`,
    );
    return;
  }

  const results = await runRegistryScan();
  const leaks = results.filter((r) => r.status === "leak").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(
    `scanned ${results.length} repos in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ` +
      `${leaks} leaking, ${errors} errored`,
  );
}

// Top-level await isn't available here (this runs as CommonJS), and a rejected
// promise must fail the step rather than pass quietly.
main().catch((error: any) => {
  console.error(`scan failed: ${error?.message ?? error}`);
  process.exit(1);
});
