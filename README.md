# scrapling-js

A TypeScript port of [Scrapling](https://github.com/D4Vinci/Scrapling)'s HTTP layer for **Bun** and **Cloudflare Workers** — realistic browser headers, **wreq-js** TLS impersonation, and a cheerio-backed CSS/XPath selector API with a requests-like ergonomics.

## Features

- **Stealth headers** — generates coherent Chrome/Firefox/Edge header sets (Client Hints, `Sec-Fetch-*`, Accept ordering) matching real browser fingerprints. Chrome versions track the wreq-js TLS profiles (`chrome_145–147`).
- **TLS impersonation** — pairs the headers with [`wreq-js`](https://www.npmjs.com/package/wreq-js) (Rust/BoringSSL) so the JA3/JA4 + HTTP/2 fingerprint matches the claimed browser (`stealth-proxy.ts`).
- **Fetcher / FetcherSession** — one-shot and stateful (cookie-preserving) HTTP clients with retry and proxy rotation.
- **Selector API** — `Selector`/`Selectors` over cheerio with `::text` / `::attr()` pseudo-elements and CSS + XPath.
- **Runs at the edge** — the core has no Node-only dependencies, so it deploys to Cloudflare Workers.

## Install

```bash
bun add github:anusoft/scrapling-js
```

For generated crawling scripts, bootstrap the current script directory with
curl and bash. The installer adds Bun if it is missing, initializes a minimal Bun
project if needed, then runs `bun add github:anusoft/scrapling-js`:

```bash
curl -fsSL https://raw.githubusercontent.com/anusoft/scrapling-js/main/install.sh | bash
```

From a repo clone, the same script installs development dependencies and builds
`dist/`:

```bash
./install.sh
```

## Usage

```ts
import { Fetcher } from "scrapling-js";

// Static fetch with stealthy headers
const page = await Fetcher.get("https://example.com");
const links = page.css("a::attr(href)").getAll();
const title = page.css("title::text").get();
```

### Stateful session

```ts
import { FetcherSession } from "scrapling-js";

const session = new FetcherSession({ baseUrl: "https://example.com" });
await session.post("/login", { data: { user: "demo", pass: "demo" } });
const dash = await session.get("/dashboard"); // cookies preserved
```

### TLS-impersonation proxy

`stealth-proxy.ts` is a Bun server that wraps `wreq-js` to add full Chrome TLS impersonation on top of the stealth headers:

```bash
bun run stealth-proxy.ts          # listens on :3001
curl "http://localhost:3001/fetch?url=https://tls.peet.ws/api/all"
```

## Header generation

`generateChromeHeaders(url?)` returns `{ headers, os, version }` where `version` feeds wreq-js's `chrome_<version>` TLS profile, keeping the User-Agent, Client Hints, and TLS fingerprint all consistent. `generateHeaders()` returns a weighted Chrome/Firefox/Edge mix for the header-only path.

## Benchmark

`benchmark.ts` scores scrapling-js's own stealth output (the wreq-js TLS path) against
public TLS/HTTP-2 fingerprint reflectors — a real Chrome scores ~100%, a stock client ~35%:

```bash
bun run benchmark.ts            # all sites (peetws, browserleaks, cftrace)
bun run benchmark.ts peetws     # a single site
```

It checks JA3/JA4 (Chrome `t13d…` prefix), HTTP/2, TLS 1.3, modern AEAD ciphers, ALPN,
and User-Agent realism — the same signals an anti-bot WAF inspects at the transport layer.

## Develop

```bash
bun install
bun test        # unit + integration tests
bun run typecheck
bun run build   # -> dist/
```

## License

MIT
