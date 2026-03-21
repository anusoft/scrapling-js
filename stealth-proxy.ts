#!/usr/bin/env bun
/**
 * Bun Stealth Proxy — persistent HTTP server wrapping wreq-js + scrapling-js headers.
 * Provides Chrome TLS impersonation (90% stealth) via local HTTP API.
 *
 * Endpoints:
 *   GET  /fetch?url=<url>  — fetch with TLS impersonation, return JSON
 *   POST /fetch            — same, URL in JSON body { url }
 *   GET  /health           — health check
 *   GET  /                 — usage info
 *
 * Start: bun scrapling-js/stealth-proxy.ts
 * PM2:   pm2 start bun --name "stealth-proxy" --cwd /home/anu/scrape -- scrapling-js/stealth-proxy.ts
 */

import { fetch as wreqFetch } from "wreq-js";
import { generateChromeHeaders } from "./src/index";

const PORT = parseInt(process.env.STEALTH_PROXY_PORT || "3001", 10);

async function stealthFetch(targetUrl: string): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
}> {
  const { headers: stealthHeaders, os, version } = generateChromeHeaders(targetUrl);

  const resp = await wreqFetch(targetUrl, {
    browser: `chrome_${version}`,
    os,
    headers: stealthHeaders,
  });

  const body = await resp.text();
  const respHeaders: Record<string, string> = {};
  resp.headers.forEach((v: string, k: string) => {
    respHeaders[k] = v;
  });

  return { status: resp.status, headers: respHeaders, body };
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", port: PORT, engine: "wreq-js" });
    }

    if (url.pathname === "/fetch") {
      let targetUrl: string | null = null;

      if (req.method === "GET") {
        targetUrl = url.searchParams.get("url");
      } else if (req.method === "POST") {
        const body = (await req.json()) as { url?: string };
        targetUrl = body.url || null;
      }

      if (!targetUrl) {
        return Response.json({ error: "Missing url parameter" }, { status: 400 });
      }

      try {
        const result = await stealthFetch(targetUrl);
        return Response.json(result);
      } catch (e: any) {
        return Response.json(
          { error: e.message || String(e), status: 0, headers: {}, body: "" },
          { status: 502 }
        );
      }
    }

    return Response.json(
      {
        name: "stealth-proxy",
        description: "wreq-js TLS impersonation + scrapling-js headers (90% stealth)",
        endpoints: {
          "GET /fetch?url=<url>": "Fetch with Chrome TLS + stealth headers",
          "POST /fetch": "Same, URL in JSON body { url }",
          "GET /health": "Health check",
        },
      },
      { status: 200 }
    );
  },
});

console.log(`Stealth proxy listening on http://localhost:${server.port}`);
