#!/usr/bin/env bun
/**
 * scrapling-js HTTP stealth benchmark
 * ===================================
 * Scores scrapling-js's own stealth output (the wreq-js TLS-impersonation path:
 * generateChromeHeaders + wreq `chrome_<version>`) against public TLS/HTTP-2
 * fingerprint reflectors. A real Chrome scores ~100%; a stock HTTP client ~35%.
 *
 *   bun run benchmark.ts                 # all sites
 *   bun run benchmark.ts peetws          # one site
 *
 * No credentials, no external services — just the library and live fingerprint APIs.
 */

import { fetch } from "wreq-js";
import { generateChromeHeaders } from "./src/index";

const CHROME_JA4_PREFIX = "t13d"; // TLS 1.3, desktop

type Check = { name: string; pass: boolean; detail: string };

async function fetchJson(url: string): Promise<any> {
  const { headers, os, version } = generateChromeHeaders(url);
  const resp = await fetch(url, { browser: `chrome_${version}`, os, headers });
  return JSON.parse(await resp.text());
}

async function fetchText(url: string): Promise<string> {
  const { headers, os, version } = generateChromeHeaders(url);
  const resp = await fetch(url, { browser: `chrome_${version}`, os, headers });
  return resp.text();
}

// --- scorers -----------------------------------------------------------------

function scorePeet(d: any): Check[] {
  const tls = d.tls ?? {};
  const ua: string = d.user_agent ?? "";
  const ciphers: string[] = (tls.ciphers ?? []).map(String);
  const exts = (tls.extensions ?? []).map((e: any) => (e?.name ?? String(e)).toLowerCase());
  const ja4: string = tls.ja4 ?? "";
  return [
    { name: "TLS 1.3", pass: /Tls13|0x0304|772/.test(tls.tls_version_negotiated ?? ""), detail: tls.tls_version_negotiated ?? "?" },
    { name: "JA4 Chrome-like", pass: ja4.startsWith(CHROME_JA4_PREFIX), detail: ja4.slice(0, 22) || "missing" },
    { name: "JA3 hash present", pass: !!tls.ja3_hash, detail: (tls.ja3_hash ?? "missing").slice(0, 16) },
    { name: "HTTP/2", pass: String(d.http_version ?? "").includes("2"), detail: d.http_version ?? "?" },
    { name: "Chrome User-Agent", pass: ua.includes("Chrome/") && ua.includes("Mozilla/5.0"), detail: ua.slice(0, 40) },
    { name: "UA not a bot lib", pass: !/python|httpx|axios|curl|wget|scrapy|requests|node/i.test(ua), detail: "" },
    { name: "Modern AEAD ciphers", pass: ciphers.some((c) => c.includes("AES_128_GCM") || c.includes("CHACHA20")), detail: `${ciphers.length} ciphers` },
    { name: "ALPN extension", pass: exts.some((n: string) => n.includes("application_layer") || n.includes("alpn")), detail: `${exts.length} exts` },
  ];
}

function scoreBrowserleaks(d: any): Check[] {
  const ua: string = d.user_agent ?? "";
  return [
    { name: "JA3 present", pass: !!(d.ja3_hash ?? d.ja3n_hash), detail: (d.ja3_hash ?? "missing").slice(0, 16) },
    { name: "JA4 present", pass: !!d.ja4, detail: (d.ja4 ?? "missing").slice(0, 22) },
    { name: "Akamai H2 hash", pass: !!(d.akamai_hash ?? d.akamai_text), detail: d.akamai_hash ? "present" : "missing" },
    { name: "Chrome User-Agent", pass: ua.includes("Chrome/"), detail: ua.slice(0, 40) },
    { name: "UA not a bot lib", pass: !/python|httpx|curl|requests|node/i.test(ua), detail: "" },
  ];
}

function scoreCfTrace(text: string): Check[] {
  const kv: Record<string, string> = {};
  text.trim().split("\n").forEach((l) => { const i = l.indexOf("="); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 1); });
  return [
    { name: "HTTP/2+", pass: /2|3/.test(kv.http ?? ""), detail: kv.http ?? "?" },
    { name: "TLS 1.3", pass: (kv.tls ?? "").includes("1.3"), detail: kv.tls ?? "?" },
    { name: "Chrome User-Agent", pass: (kv.uag ?? "").includes("Chrome/"), detail: (kv.uag ?? "").slice(0, 40) },
  ];
}

const SITES: Record<string, { url: string; run: () => Promise<Check[]> }> = {
  peetws: { url: "https://tls.peet.ws/api/all", run: async () => scorePeet(await fetchJson("https://tls.peet.ws/api/all")) },
  browserleaks: { url: "https://tls.browserleaks.com/json", run: async () => scoreBrowserleaks(await fetchJson("https://tls.browserleaks.com/json")) },
  cftrace: { url: "https://www.cloudflare.com/cdn-cgi/trace", run: async () => scoreCfTrace(await fetchText("https://www.cloudflare.com/cdn-cgi/trace")) },
};

// --- runner ------------------------------------------------------------------

async function main() {
  const want = process.argv.slice(2);
  const names = want.length ? want.filter((n) => n in SITES) : Object.keys(SITES);

  let totalPass = 0, totalAll = 0;
  console.log("\nscrapling-js HTTP stealth benchmark (wreq-js TLS path)\n" + "=".repeat(56));
  for (const name of names) {
    const site = SITES[name];
    process.stdout.write(`\n${name}  (${site.url})\n`);
    let checks: Check[];
    const t0 = Date.now();
    try {
      checks = await site.run();
    } catch (e: any) {
      console.log(`  ERROR: ${e.message || e}`);
      continue;
    }
    const ms = Date.now() - t0;
    const pass = checks.filter((c) => c.pass).length;
    totalPass += pass; totalAll += checks.length;
    for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(22)} ${c.detail}`);
    console.log(`  -> ${pass}/${checks.length} (${Math.round((pass / checks.length) * 100)}%, ${ms}ms)`);
  }
  console.log("\n" + "=".repeat(56));
  console.log(`OVERALL: ${totalPass}/${totalAll} = ${totalAll ? Math.round((totalPass / totalAll) * 100) : 0}%\n`);
}

main();
