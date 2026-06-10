#!/usr/bin/env bun
/**
 * Benchmark helper: fetch a URL using scrapling-js headers + node:http2.
 * Called by http_benchmark.py via subprocess.
 *
 * Uses node:http2 directly (instead of Bun's native fetch which is HTTP/1.1 only)
 * with Chrome-matching HTTP/2 SETTINGS:
 *   HEADER_TABLE_SIZE=65536, MAX_CONCURRENT_STREAMS=1000,
 *   INITIAL_WINDOW_SIZE=6291456, MAX_HEADER_LIST_SIZE=262144
 * And Chrome pseudo-header order: :method, :authority, :scheme, :path (m,a,s,p)
 *
 * Falls back to Bun fetch for HTTP/1.x or non-TLS URLs.
 *
 * Usage: bun scrapling-js/bench_fetch.ts <url>
 * Output: JSON { status, headers, body }
 */

import { connect } from "node:http2";
import { constants as H2 } from "node:http2";
import { generateChromeHeaders } from "./src/index";

const url = process.argv[2];
if (!url) {
  console.error("Usage: bun bench_fetch.ts <url>");
  process.exit(1);
}

interface Result {
  status: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

async function fetchViaH2(targetUrl: string, stealthHeaders: Record<string, string>): Promise<Result> {
  const u = new URL(targetUrl);

  return new Promise<Result>((resolve, reject) => {
    // Chrome's HTTP/2 SETTINGS frame values (captured from real Chrome 145):
    //   SETTINGS_HEADER_TABLE_SIZE = 65536 (default 4096)
    //   SETTINGS_MAX_CONCURRENT_STREAMS = 1000 (default unlimited)
    //   SETTINGS_INITIAL_WINDOW_SIZE = 6291456 (6 MB, default 65535)
    //   SETTINGS_MAX_HEADER_LIST_SIZE = 262144 (default unlimited)
    //   SETTINGS_ENABLE_PUSH is omitted by Chrome (node defaults to 0 which is correct)
    const client = connect(`${u.protocol}//${u.host}`, {
      settings: {
        headerTableSize: 65536,
        enablePush: false,
        maxConcurrentStreams: 1000,
        initialWindowSize: 6291456,
        maxHeaderListSize: 262144,
      },
    });

    client.on("error", (err) => {
      client.close();
      reject(err);
    });

    // Chrome pseudo-header order: :method, :authority, :scheme, :path (m,a,s,p).
    // node:http2 preserves insertion order of the headers object, so explicit order here matters.
    const pseudoAndHeaders: Record<string, string | number> = {
      ":method": "GET",
      ":authority": u.host,
      ":scheme": u.protocol.replace(":", ""),
      ":path": u.pathname + u.search,
      // Chrome's header order for top-level navigation — matches what
      // generateChromeHeaders already produces.
      ...stealthHeaders,
    };

    // Lowercase all non-pseudo header names (HTTP/2 requires lowercase; node
    // lowercases automatically but passing mixed-case can trigger warnings).
    const lowered: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(pseudoAndHeaders)) {
      lowered[k.startsWith(":") ? k : k.toLowerCase()] = v;
    }

    const req = client.request(lowered);

    let statusCode = 0;
    let responseReceived = false;
    const respHeaders: Record<string, string> = {};

    req.on("response", (headers) => {
      responseReceived = true;
      statusCode = Number(headers[H2.HTTP2_HEADER_STATUS]) || 0;
      for (const [k, v] of Object.entries(headers)) {
        if (typeof k === "string" && !k.startsWith(":")) {
          respHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
        }
      }
    });

    // Some servers send GOAWAY without ever sending response headers
    // (e.g. if they don't like our SETTINGS frame values). Treat as failure
    // so the caller can fall back to Bun fetch.
    client.on("goaway", () => {
      if (!responseReceived) {
        client.close();
        reject(new Error("Server sent GOAWAY before response"));
      }
    });

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));

    req.on("end", () => {
      client.close();
      if (!responseReceived) {
        return reject(new Error("Stream ended without response"));
      }
      let body = Buffer.concat(chunks);
      // Decompress if needed — node:http2 doesn't auto-decompress
      const enc = respHeaders["content-encoding"] || "";
      try {
        if (enc.includes("gzip")) {
          body = require("node:zlib").gunzipSync(body);
        } else if (enc.includes("br")) {
          body = require("node:zlib").brotliDecompressSync(body);
        } else if (enc.includes("deflate")) {
          body = require("node:zlib").inflateSync(body);
        } else if (enc.includes("zstd")) {
          // node 22+ has zstdDecompressSync; fall back silently
          try {
            body = require("node:zlib").zstdDecompressSync(body);
          } catch {}
        }
      } catch (e) {
        // If decompression fails, fall through to raw buffer
      }

      resolve({
        status: statusCode,
        headers: respHeaders,
        body: body.toString("utf-8"),
      });
    });

    req.on("error", (err) => {
      client.close();
      reject(err);
    });

    // Timeout: 30s
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error("Timeout after 30s"));
    }, 30000);
    req.on("close", () => clearTimeout(timeout));

    req.end();
  });
}

async function main() {
  try {
    const { headers: stealthHeaders } = generateChromeHeaders(url);
    const u = new URL(url);

    let result: Result;
    if (u.protocol === "https:") {
      try {
        result = await fetchViaH2(url, stealthHeaders);
      } catch (h2Err: any) {
        // Fallback to Bun fetch on H2 failure (server forced HTTP/1.1 or similar)
        const raw = await fetch(url, {
          headers: stealthHeaders,
          signal: AbortSignal.timeout(30000),
        });
        const body = await raw.text();
        const respHeaders: Record<string, string> = {};
        raw.headers.forEach((v, k) => (respHeaders[k] = v));
        result = { status: raw.status, headers: respHeaders, body };
      }
    } else {
      // HTTP (not HTTPS) — use Bun fetch
      const raw = await fetch(url, {
        headers: stealthHeaders,
        signal: AbortSignal.timeout(30000),
      });
      const body = await raw.text();
      const respHeaders: Record<string, string> = {};
      raw.headers.forEach((v, k) => (respHeaders[k] = v));
      result = { status: raw.status, headers: respHeaders, body };
    }

    process.stdout.write(JSON.stringify(result));
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
}

main();
