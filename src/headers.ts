/**
 * Anti-bot header generation for scrapling-js.
 *
 * Generates realistic browser headers matching browserforge output patterns.
 * Supports Chrome, Firefox, and Edge with proper Client Hints and Sec-Fetch headers.
 */

// Browser version pools (keep in sync with Scrapling's fingerprints.py).
// Chrome is capped at 147 because the wreq-js TLS profiles (used for the
// impersonated path in stealth-proxy.ts / bench_fetch_wreq.ts) ship through
// chrome_147; 145-147 brackets the system Chrome (148) the browser tier runs.
const CHROME_VERSIONS = [145, 146, 147];
const FIREFOX_VERSIONS = [142, 143, 144];
const EDGE_VERSIONS = [145, 146, 147];

// Not-A-Brand tokens Chrome rotates per major version
const NOT_A_BRAND_TOKENS = [
  '"Not?A_Brand";v="8"',
  '"Not/A)Brand";v="8"',
  '"Not A(Brand";v="99"',
  '"Not)A;Brand";v="8"',
];

// OS user-agent fragments
const OS_STRINGS = [
  "Windows NT 10.0; Win64; x64",
  "Macintosh; Intel Mac OS X 10_15_7",
  "X11; Linux x86_64",
] as const;

type OsString = (typeof OS_STRINGS)[number];

// Sec-Ch-Ua-Platform values matching OS_STRINGS
const PLATFORM_MAP: Record<OsString, string> = {
  "Windows NT 10.0; Win64; x64": '"Windows"',
  "Macintosh; Intel Mac OS X 10_15_7": '"macOS"',
  "X11; Linux x86_64": '"Linux"',
};

// wreq-js os parameter matching OS_STRINGS
const WREQ_OS_MAP: Record<OsString, string> = {
  "Windows NT 10.0; Win64; x64": "windows",
  "Macintosh; Intel Mac OS X 10_15_7": "macos",
  "X11; Linux x86_64": "linux",
};

type BrowserType = "chrome" | "firefox" | "edge";

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Pick a browser type with Chrome weighted heavily (80%), Firefox (12%), Edge (8%).
 */
function pickBrowser(): BrowserType {
  const r = Math.random();
  if (r < 0.80) return "chrome";
  if (r < 0.92) return "firefox";
  return "edge";
}

function buildUserAgent(browser: BrowserType, version: number, os: OsString): string {
  switch (browser) {
    case "chrome":
      return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
    case "firefox":
      return `Mozilla/5.0 (${os}; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
    case "edge":
      return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36 Edg/${version}.0.0.0`;
  }
}

/**
 * Build sec-ch-ua header matching real Chrome/Edge format.
 * Chrome rotates the "Not A Brand" token and order per major version.
 */
function buildSecChUa(browser: BrowserType, version: number): string {
  const notABrand = pickRandom(NOT_A_BRAND_TOKENS);
  switch (browser) {
    case "chrome":
      return `"Google Chrome";v="${version}", ${notABrand}, "Chromium";v="${version}"`;
    case "edge":
      return `"Microsoft Edge";v="${version}", ${notABrand}, "Chromium";v="${version}"`;
    default:
      return "";
  }
}

// Chrome Accept header variants (from real browser captures)
const CHROME_ACCEPT_VARIANTS = [
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
];

// Firefox Accept header
const FIREFOX_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8";

/**
 * Generate realistic browser headers for anti-bot evasion.
 *
 * Randomly picks Chrome (heavily weighted), Firefox, or Edge with realistic
 * version numbers and OS strings. Header format matches browserforge output.
 */
export function generateHeaders(): Record<string, string> {
  const browser = pickBrowser();
  const os = pickRandom(OS_STRINGS);

  let version: number;
  switch (browser) {
    case "chrome":
      version = pickRandom(CHROME_VERSIONS);
      break;
    case "firefox":
      version = pickRandom(FIREFOX_VERSIONS);
      break;
    case "edge":
      version = pickRandom(EDGE_VERSIONS);
      break;
  }

  const headers: Record<string, string> = {};

  if (browser === "chrome" || browser === "edge") {
    // Chromium headers — order matters for fingerprinting.
    // Match real Chrome header order: sec-ch-ua first, then UA, Accept, Sec-Fetch, Accept-*
    headers["sec-ch-ua"] = buildSecChUa(browser, version);
    headers["sec-ch-ua-mobile"] = "?0";
    headers["sec-ch-ua-platform"] = PLATFORM_MAP[os];
    headers["Upgrade-Insecure-Requests"] = "1";
    headers["User-Agent"] = buildUserAgent(browser, version, os);
    headers["Accept"] = pickRandom(CHROME_ACCEPT_VARIANTS);
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-User"] = "?1";
    headers["Sec-Fetch-Dest"] = "document";
    headers["Accept-Encoding"] = "gzip, deflate, br, zstd";
    headers["Accept-Language"] = "en-US,en;q=0.9";
  } else {
    // Firefox headers — no Client Hints, different Accept header
    headers["User-Agent"] = buildUserAgent(browser, version, os);
    headers["Accept"] = FIREFOX_ACCEPT;
    headers["Accept-Language"] = "en-US,en;q=0.5";
    headers["Accept-Encoding"] = "gzip, deflate, br, zstd";
    headers["Upgrade-Insecure-Requests"] = "1";
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-User"] = "?1";
    headers["Connection"] = "keep-alive";
  }

  return headers;
}

export interface ChromeHeadersResult {
  headers: Record<string, string>;
  os: string;       // wreq-js os param: "windows" | "macos" | "linux"
  version: number;  // Chrome version number
}

/**
 * Generate Chrome-only headers for use with TLS impersonation (wreq-js).
 *
 * Always returns Chrome headers (never Firefox/Edge) so the UA matches
 * the TLS fingerprint. Also returns the OS string for wreq-js `os` param.
 */
export function generateChromeHeaders(url?: string): ChromeHeadersResult {
  const os = pickRandom(OS_STRINGS);
  const version = pickRandom(CHROME_VERSIONS);
  const notABrand = pickRandom(NOT_A_BRAND_TOKENS);

  const headers: Record<string, string> = {
    "sec-ch-ua": `"Google Chrome";v="${version}", ${notABrand}, "Chromium";v="${version}"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": PLATFORM_MAP[os],
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
    "Accept": pickRandom(CHROME_ACCEPT_VARIANTS),
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // Add Google referer if URL provided
  if (url) {
    const referer = generateReferer(url);
    if (referer) {
      headers["Referer"] = referer;
    }
  }

  return {
    headers,
    os: WREQ_OS_MAP[os],
    version,
  };
}

/**
 * Generate a Google search referer for the given URL.
 *
 * Extracts the domain from the URL (stripping "www.") and returns a
 * Google search URL. Returns null for localhost, loopback addresses,
 * and IP addresses.
 */
export function generateReferer(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  // Reject localhost, loopback, and IPv6 loopback
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return null;
  }

  // Reject IP addresses (IPv4 pattern)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return null;
  }

  // Reject IPv6 addresses (bracketed in URLs, hostname may contain colons)
  if (hostname.includes(":")) {
    return null;
  }

  // Strip www. prefix
  const domain = hostname.replace(/^www\./, "");

  return `https://www.google.com/search?q=${domain}`;
}
