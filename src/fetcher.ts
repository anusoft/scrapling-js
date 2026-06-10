/**
 * HTTP Fetcher and FetcherSession for scrapling-js.
 *
 * Fetcher provides static methods for one-off HTTP requests.
 * FetcherSession maintains cookies and default settings across requests.
 *
 * Both classes generate stealth browser headers by default to avoid bot detection
 * and wrap responses in the Response class for DOM querying.
 */

import { Response, type ResponseInit } from "./response";
import { generateHeaders, generateReferer } from "./headers";
import type { ProxyRotator } from "./proxy";

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/** Options for individual Fetcher requests. */
export interface FetcherOptions {
  /** Custom headers to merge with generated headers (takes precedence). */
  headers?: Record<string, string>;
  /** Generate stealth browser headers. Default: true. */
  stealthyHeaders?: boolean;
  /** Request timeout in milliseconds. Default: 30000. */
  timeout?: number;
  /** Number of retry attempts on failure. Default: 3. */
  retries?: number;
  /** Delay between retries in milliseconds. Default: 1000. */
  retryDelay?: number;
  /** Follow HTTP redirects. Default: true. */
  followRedirects?: boolean;
  /** Query parameters appended to the URL. */
  params?: Record<string, string>;
  /** Form-encoded body for POST/PUT/DELETE. */
  data?: Record<string, string>;
  /** JSON body for POST/PUT/DELETE. */
  json?: any;
  /** Explicit cookies sent with the request. */
  cookies?: Record<string, string>;
}

/** Options for constructing a FetcherSession. */
export interface SessionOptions {
  /** Generate stealth browser headers. Default: true. */
  stealthyHeaders?: boolean;
  /** Request timeout in milliseconds. Default: 30000. */
  timeout?: number;
  /** Number of retry attempts on failure. Default: 3. */
  retries?: number;
  /** Delay between retries in milliseconds. Default: 1000. */
  retryDelay?: number;
  /** Default headers for all session requests. */
  headers?: Record<string, string>;
  /** Follow HTTP redirects. Default: true. */
  followRedirects?: boolean;
  /** Single proxy URL for all requests. */
  proxy?: string;
  /** Proxy rotator for rotating proxies across requests. */
  proxyRotator?: ProxyRotator;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append query parameters to a URL.
 */
function buildUrl(url: string, params?: Record<string, string>): string {
  if (!params || Object.keys(params).length === 0) return url;
  const urlObj = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    urlObj.searchParams.set(key, value);
  }
  return urlObj.toString();
}

/**
 * Build request headers.
 *
 * When stealth mode is enabled, generates realistic browser headers and a
 * Google search referer. User-supplied headers take precedence over generated
 * ones. Cookies are serialized into the Cookie header.
 */
function buildHeaders(
  url: string,
  userHeaders?: Record<string, string>,
  stealth: boolean = true,
  cookies?: Record<string, string>,
): Record<string, string> {
  let headers: Record<string, string> = {};

  if (stealth) {
    headers = generateHeaders();
    const referer = generateReferer(url);
    if (referer) {
      headers["Referer"] = referer;
    }
  }

  // User headers override generated ones
  if (userHeaders) {
    for (const [key, value] of Object.entries(userHeaders)) {
      headers[key] = value;
    }
  }

  // Serialize cookies into the Cookie header
  if (cookies && Object.keys(cookies).length > 0) {
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    headers["Cookie"] = cookieStr;
  }

  return headers;
}

/**
 * Parse Set-Cookie headers from a response and merge with existing cookies.
 *
 * Handles both the modern `headers.getSetCookie()` method and the fallback
 * `headers.get("set-cookie")` approach.
 */
function parseCookies(
  headers: globalThis.Headers,
  existing: Record<string, string> = {},
): Record<string, string> {
  const cookies = { ...existing };

  // Try modern getSetCookie() first
  let setCookieHeaders: string[] = [];
  if (typeof headers.getSetCookie === "function") {
    setCookieHeaders = headers.getSetCookie();
  }

  // Fallback: if getSetCookie returned nothing, try get("set-cookie")
  if (setCookieHeaders.length === 0) {
    const raw = headers.get("set-cookie");
    if (raw) {
      // Multiple Set-Cookie headers may be comma-joined; split carefully.
      // However, cookies can contain commas in expires dates, so we split
      // on ", " followed by a token= pattern. For simplicity with the
      // fallback, we split on newlines (some runtimes join with \n).
      setCookieHeaders = raw.split(/,(?=\s*[^;=]+=[^;]*)/);
    }
  }

  for (const header of setCookieHeaders) {
    // Each Set-Cookie header looks like: name=value; Path=/; ...
    const trimmed = header.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const name = trimmed.substring(0, eqIdx).trim();
    // Value ends at the first semicolon
    const rest = trimmed.substring(eqIdx + 1);
    const semiIdx = rest.indexOf(";");
    const value = semiIdx === -1 ? rest.trim() : rest.substring(0, semiIdx).trim();
    if (name) {
      cookies[name] = value;
    }
  }

  return cookies;
}

/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an HTTP request with retry logic.
 *
 * Builds headers, applies body encoding (JSON or form), handles timeouts,
 * and retries on failure with the specified delay.
 */
async function makeRequest(
  method: string,
  url: string,
  options: FetcherOptions = {},
  existingCookies: Record<string, string> = {},
): Promise<{ response: Response; cookies: Record<string, string> }> {
  const {
    stealthyHeaders = true,
    timeout = 30000,
    retries = 3,
    retryDelay = 1000,
    followRedirects = true,
    params,
    data,
    json,
    cookies: explicitCookies,
  } = options;

  const finalUrl = buildUrl(url, params);

  // Merge explicit cookies with existing (session) cookies
  const mergedCookies = { ...existingCookies, ...explicitCookies };

  const headers = buildHeaders(finalUrl, options.headers, stealthyHeaders, mergedCookies);

  // Build request init
  const fetchInit: RequestInit = {
    method: method.toUpperCase(),
    headers,
    redirect: followRedirects ? "follow" : "manual",
    signal: AbortSignal.timeout(timeout),
  };

  // Attach body for non-GET methods
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchInit.body = JSON.stringify(json);
    fetchInit.headers = headers;
  } else if (data) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    fetchInit.body = new URLSearchParams(data).toString();
    fetchInit.headers = headers;
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const raw = await fetch(finalUrl, fetchInit);

      // Parse cookies from response
      const responseCookies = parseCookies(raw.headers, mergedCookies);

      // Read response body
      const body = await raw.text();

      // Build Response object
      const responseInit: ResponseInit = {
        url: raw.url || finalUrl,
        body,
        status: raw.status,
        statusText: raw.statusText,
        headers: raw.headers,
        cookies: responseCookies,
        requestHeaders: headers,
      };

      return {
        response: new Response(responseInit),
        cookies: responseCookies,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // If we have retries remaining, wait before next attempt
      if (attempt < retries - 1) {
        await sleep(retryDelay);
      }
    }
  }

  throw lastError || new Error(`Request failed after ${retries} attempts`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetcher — static one-off requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Static HTTP client for one-off requests.
 *
 * Each request is independent — no cookies are preserved between calls.
 * Generates stealth browser headers by default.
 *
 * @example
 * ```ts
 * const resp = await Fetcher.get("https://example.com");
 * console.log(resp.status);         // 200
 * console.log(resp.css("h1").text); // page title
 * ```
 */
export class Fetcher {
  /** Send a GET request. */
  static async get(url: string, options?: FetcherOptions): Promise<Response> {
    const { response } = await makeRequest("GET", url, options);
    return response;
  }

  /** Send a POST request. */
  static async post(url: string, options?: FetcherOptions): Promise<Response> {
    const { response } = await makeRequest("POST", url, options);
    return response;
  }

  /** Send a PUT request. */
  static async put(url: string, options?: FetcherOptions): Promise<Response> {
    const { response } = await makeRequest("PUT", url, options);
    return response;
  }

  /** Send a DELETE request. */
  static async delete(url: string, options?: FetcherOptions): Promise<Response> {
    const { response } = await makeRequest("DELETE", url, options);
    return response;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FetcherSession — stateful HTTP client with cookie persistence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stateful HTTP client that maintains cookies across requests.
 *
 * Use FetcherSession when you need to preserve login state, CSRF tokens,
 * or other cookie-based session data across multiple requests.
 *
 * @example
 * ```ts
 * const session = new FetcherSession({ stealthyHeaders: true });
 * await session.post("/login", { data: { user: "admin", pass: "secret" } });
 * const dashboard = await session.get("/dashboard");
 * console.log(session.cookies); // { session: "abc123", ... }
 * ```
 */
export class FetcherSession {
  private _stealthyHeaders: boolean;
  private _timeout: number;
  private _retries: number;
  private _retryDelay: number;
  private _headers: Record<string, string>;
  private _followRedirects: boolean;
  private _proxy?: string;
  private _proxyRotator?: ProxyRotator;
  private _cookies: Record<string, string>;

  constructor(options: SessionOptions = {}) {
    this._stealthyHeaders = options.stealthyHeaders ?? true;
    this._timeout = options.timeout ?? 30000;
    this._retries = options.retries ?? 3;
    this._retryDelay = options.retryDelay ?? 1000;
    this._headers = options.headers ? { ...options.headers } : {};
    this._followRedirects = options.followRedirects ?? true;
    this._proxy = options.proxy;
    this._proxyRotator = options.proxyRotator;
    this._cookies = {};
  }

  /** Get a copy of the current cookie jar. */
  get cookies(): Record<string, string> {
    return { ...this._cookies };
  }

  /** Clear all cookies from the session. */
  clearCookies(): void {
    this._cookies = {};
  }

  /**
   * Merge session defaults with per-request options.
   * Per-request options take precedence over session defaults.
   */
  private _mergeOptions(options?: FetcherOptions): FetcherOptions {
    const merged: FetcherOptions = {
      stealthyHeaders: this._stealthyHeaders,
      timeout: this._timeout,
      retries: this._retries,
      retryDelay: this._retryDelay,
      followRedirects: this._followRedirects,
      ...options,
      // Merge headers: session defaults + per-request overrides
      headers: {
        ...this._headers,
        ...(options?.headers || {}),
      },
    };
    return merged;
  }

  /**
   * Execute a request, updating the session cookie jar from the response.
   */
  private async _request(
    method: string,
    url: string,
    options?: FetcherOptions,
  ): Promise<Response> {
    const merged = this._mergeOptions(options);
    const { response, cookies } = await makeRequest(method, url, merged, this._cookies);
    // Update session cookie jar
    this._cookies = cookies;
    return response;
  }

  /** Send a GET request. */
  async get(url: string, options?: FetcherOptions): Promise<Response> {
    return this._request("GET", url, options);
  }

  /** Send a POST request. */
  async post(url: string, options?: FetcherOptions): Promise<Response> {
    return this._request("POST", url, options);
  }

  /** Send a PUT request. */
  async put(url: string, options?: FetcherOptions): Promise<Response> {
    return this._request("PUT", url, options);
  }

  /** Send a DELETE request. */
  async delete(url: string, options?: FetcherOptions): Promise<Response> {
    return this._request("DELETE", url, options);
  }
}
