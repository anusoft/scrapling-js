#!/usr/bin/env bun
/**
 * Benchmark helper: fetch URL using wreq-js (TLS impersonation + HTTP/2)
 * combined with scrapling-js Chrome header generation (Google referer, Sec-CH-UA).
 *
 * Always generates Chrome headers to match wreq-js Chrome TLS fingerprint.
 * OS in headers matches wreq-js `os` param to avoid inconsistency.
 *
 * Usage: bun scrapling-js/bench_fetch_wreq.ts <url>
 * Output: JSON { status, headers, body }
 */

import { fetch } from "wreq-js";
import { generateChromeHeaders } from "./src/index";

const url = process.argv[2];
if (!url) {
  console.error("Usage: bun bench_fetch_wreq.ts <url>");
  process.exit(1);
}

try {
  // Generate Chrome-only headers with matching OS for wreq-js
  const { headers: stealthHeaders, os, version } = generateChromeHeaders(url);

  // wreq-js handles TLS fingerprinting (Chrome JA4) and HTTP/2
  // Headers match the impersonated browser exactly
  const resp = await fetch(url, {
    browser: `chrome_${version}`,
    os,
    headers: stealthHeaders,
  });

  const body = await resp.text();
  const respHeaders: Record<string, string> = {};
  resp.headers.forEach((v: string, k: string) => {
    respHeaders[k] = v;
  });

  process.stdout.write(
    JSON.stringify({
      status: resp.status,
      headers: respHeaders,
      body,
    })
  );
} catch (e: any) {
  process.stdout.write(
    JSON.stringify({
      error: e.message || String(e),
      status: 0,
      headers: {},
      body: "",
    })
  );
  process.exit(1);
}
