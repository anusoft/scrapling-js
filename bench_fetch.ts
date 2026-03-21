#!/usr/bin/env bun
/**
 * Benchmark helper: fetch a URL using scrapling-js Fetcher and output JSON result.
 * Called by http_benchmark.py via subprocess.
 *
 * Usage: bun scrapling-js/bench_fetch.ts <url>
 * Output: JSON { status, headers, body }
 */

import { generateChromeHeaders } from "./src/index";

const url = process.argv[2];
if (!url) {
  console.error("Usage: bun bench_fetch.ts <url>");
  process.exit(1);
}

try {
  const { headers: stealthHeaders } = generateChromeHeaders(url);

  const raw = await fetch(url, {
    headers: stealthHeaders,
    signal: AbortSignal.timeout(30000),
  });

  const body = await raw.text();
  const respHeaders: Record<string, string> = {};
  raw.headers.forEach((v: string, k: string) => {
    respHeaders[k] = v;
  });
  const result = {
    status: raw.status,
    headers: respHeaders,
    body,
  };
  // Write JSON to stdout
  process.stdout.write(JSON.stringify(result));
} catch (e: any) {
  const errResult = {
    error: e.message || String(e),
    status: 0,
    headers: {},
    body: "",
  };
  process.stdout.write(JSON.stringify(errResult));
  process.exit(1);
}
