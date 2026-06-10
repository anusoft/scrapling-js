/**
 * HTTP Response class for scrapling-js.
 *
 * Wraps raw HTTP response data (status, headers, cookies, body) and extends
 * Selector so the response body can be queried with CSS selectors directly.
 */

import { Selector } from "./selector";

/** Initialization data for constructing a Response. */
export interface ResponseInit {
  url: string;
  body: string;
  status: number;
  statusText: string;
  headers: Headers;
  cookies: Record<string, string>;
  requestHeaders?: Record<string, string>;
  history?: ResponseInit[];
  meta?: Record<string, any>;
}

/**
 * Represents an HTTP response with full metadata and DOM querying capabilities.
 *
 * Extends Selector so that CSS/XPath queries, text extraction, and other DOM
 * operations work directly on the response body.
 *
 * @example
 * ```ts
 * const resp = new Response({
 *   url: "https://example.com",
 *   body: "<html><body><h1>Hello</h1></body></html>",
 *   status: 200,
 *   statusText: "OK",
 *   headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
 *   cookies: { session: "abc123" },
 * });
 *
 * resp.ok;                    // true
 * resp.status;                // 200
 * resp.css("h1").text();      // "Hello"
 * resp.encoding;              // "utf-8"
 * ```
 */
export class Response extends Selector {
  /** HTTP status code (e.g. 200, 404, 500). */
  readonly status: number;

  /** HTTP status text (e.g. "OK", "Not Found"). */
  readonly statusText: string;

  /** Response headers. */
  readonly headers: Headers;

  /** Cookies received with the response. */
  readonly cookies: Record<string, string>;

  /** Headers that were sent with the request. */
  readonly requestHeaders: Record<string, string>;

  /** Redirect history (chain of ResponseInit objects for each redirect hop). */
  readonly history: ResponseInit[];

  /** Arbitrary metadata attached to this response. */
  readonly meta: Record<string, any>;

  /** Raw response body as a string. */
  readonly body: string;

  constructor(init: ResponseInit) {
    super(init.body, init.url);
    this.status = init.status;
    this.statusText = init.statusText;
    this.headers = init.headers;
    this.cookies = init.cookies;
    this.requestHeaders = init.requestHeaders || {};
    this.history = init.history || [];
    this.meta = init.meta || {};
    this.body = init.body;
  }

  /** True if the response status is in the 2xx range. */
  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  /**
   * Character encoding extracted from the Content-Type header.
   * Defaults to "utf-8" if no charset is specified.
   */
  get encoding(): string {
    const ct = this.headers.get("content-type") || "";
    const match = ct.match(/charset=([^\s;]+)/i);
    return match ? match[1] : "utf-8";
  }
}
