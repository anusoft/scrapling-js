import { describe, expect, test } from "bun:test";
import { Response, type ResponseInit } from "../src/response";
import { Selector } from "../src/selector";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEST_HTML = `<html><body><h1 class="title">Hello</h1><p>World</p></body></html>`;
const TEST_URL = "https://example.com/page";

/** Build a minimal ResponseInit for tests, merging with any overrides. */
function makeInit(overrides: Partial<ResponseInit> = {}): ResponseInit {
  return {
    url: TEST_URL,
    body: TEST_HTML,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    cookies: { session: "abc123" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response
// ─────────────────────────────────────────────────────────────────────────────

describe("Response", () => {
  // ── Construction & inheritance ──────────────────────────────────────

  test("extends Selector", () => {
    const resp = new Response(makeInit());
    expect(resp).toBeInstanceOf(Selector);
    expect(resp).toBeInstanceOf(Response);
  });

  // ── HTTP metadata ──────────────────────────────────────────────────

  describe("HTTP metadata", () => {
    test("stores status code", () => {
      const resp = new Response(makeInit({ status: 200 }));
      expect(resp.status).toBe(200);
    });

    test("stores statusText", () => {
      const resp = new Response(makeInit({ statusText: "OK" }));
      expect(resp.statusText).toBe("OK");
    });

    test("stores url (inherited from Selector)", () => {
      const resp = new Response(makeInit());
      expect(resp.url).toBe(TEST_URL);
    });

    test("stores cookies", () => {
      const resp = new Response(makeInit({ cookies: { token: "xyz", lang: "en" } }));
      expect(resp.cookies).toEqual({ token: "xyz", lang: "en" });
    });

    test("stores headers", () => {
      const headers = new Headers({ "x-custom": "value" });
      const resp = new Response(makeInit({ headers }));
      expect(resp.headers.get("x-custom")).toBe("value");
    });

    test("stores body", () => {
      const resp = new Response(makeInit());
      expect(resp.body).toBe(TEST_HTML);
    });

    test("stores requestHeaders", () => {
      const resp = new Response(makeInit({ requestHeaders: { "User-Agent": "test/1.0" } }));
      expect(resp.requestHeaders["User-Agent"]).toBe("test/1.0");
    });

    test("requestHeaders defaults to empty object", () => {
      const resp = new Response(makeInit());
      expect(resp.requestHeaders).toEqual({});
    });

    test("stores history", () => {
      const redirect = makeInit({ url: "https://example.com/old", status: 301 });
      const resp = new Response(makeInit({ history: [redirect] }));
      expect(resp.history.length).toBe(1);
      expect(resp.history[0].status).toBe(301);
      expect(resp.history[0].url).toBe("https://example.com/old");
    });

    test("history defaults to empty array", () => {
      const resp = new Response(makeInit());
      expect(resp.history).toEqual([]);
    });

    test("stores meta", () => {
      const resp = new Response(makeInit({ meta: { elapsed: 150, retries: 0 } }));
      expect(resp.meta.elapsed).toBe(150);
      expect(resp.meta.retries).toBe(0);
    });

    test("meta defaults to empty object", () => {
      const resp = new Response(makeInit());
      expect(resp.meta).toEqual({});
    });
  });

  // ── ok property ────────────────────────────────────────────────────

  describe("ok", () => {
    test("returns true for 200", () => {
      const resp = new Response(makeInit({ status: 200 }));
      expect(resp.ok).toBe(true);
    });

    test("returns true for 201", () => {
      const resp = new Response(makeInit({ status: 201 }));
      expect(resp.ok).toBe(true);
    });

    test("returns true for 204", () => {
      const resp = new Response(makeInit({ status: 204 }));
      expect(resp.ok).toBe(true);
    });

    test("returns true for 299 (upper boundary)", () => {
      const resp = new Response(makeInit({ status: 299 }));
      expect(resp.ok).toBe(true);
    });

    test("returns false for 199 (below 2xx)", () => {
      const resp = new Response(makeInit({ status: 199 }));
      expect(resp.ok).toBe(false);
    });

    test("returns false for 300 (redirect)", () => {
      const resp = new Response(makeInit({ status: 300 }));
      expect(resp.ok).toBe(false);
    });

    test("returns false for 404", () => {
      const resp = new Response(makeInit({ status: 404, statusText: "Not Found" }));
      expect(resp.ok).toBe(false);
    });

    test("returns false for 500", () => {
      const resp = new Response(makeInit({ status: 500, statusText: "Internal Server Error" }));
      expect(resp.ok).toBe(false);
    });
  });

  // ── encoding property ──────────────────────────────────────────────

  describe("encoding", () => {
    test("extracts charset from content-type", () => {
      const resp = new Response(
        makeInit({
          headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        }),
      );
      expect(resp.encoding).toBe("utf-8");
    });

    test("extracts non-utf-8 charset", () => {
      const resp = new Response(
        makeInit({
          headers: new Headers({ "content-type": "text/html; charset=iso-8859-1" }),
        }),
      );
      expect(resp.encoding).toBe("iso-8859-1");
    });

    test("extracts charset case-insensitively", () => {
      const resp = new Response(
        makeInit({
          headers: new Headers({ "content-type": "text/html; Charset=Shift_JIS" }),
        }),
      );
      expect(resp.encoding).toBe("Shift_JIS");
    });

    test("defaults to utf-8 when no charset", () => {
      const resp = new Response(
        makeInit({
          headers: new Headers({ "content-type": "text/html" }),
        }),
      );
      expect(resp.encoding).toBe("utf-8");
    });

    test("defaults to utf-8 when no content-type header", () => {
      const resp = new Response(
        makeInit({
          headers: new Headers(),
        }),
      );
      expect(resp.encoding).toBe("utf-8");
    });
  });

  // ── Selector method inheritance ────────────────────────────────────

  describe("inherited Selector methods", () => {
    test("css() finds elements by CSS selector", () => {
      const resp = new Response(makeInit());
      const h1 = resp.css("h1");
      expect(h1).toBeDefined();
    });

    test("css('h1') finds the h1 element", () => {
      const resp = new Response(makeInit());
      const h1 = resp.css("h1");
      // .text is a property on Selectors returning TextHandlers
      expect(h1.first()?.text.toString()).toBe("Hello");
    });

    test("css() with class selector", () => {
      const resp = new Response(makeInit());
      const el = resp.css(".title");
      expect(el.first()?.text.toString()).toBe("Hello");
    });

    test("css('p') finds the paragraph", () => {
      const resp = new Response(makeInit());
      const p = resp.css("p");
      expect(p.first()?.text.toString()).toBe("World");
    });

    test("find() locates an element", () => {
      const resp = new Response(makeInit());
      const el = resp.find("h1");
      expect(el).toBeDefined();
    });

    test("findAll() returns all matching elements", () => {
      const html = `<html><body><li>A</li><li>B</li><li>C</li></body></html>`;
      const resp = new Response(makeInit({ body: html }));
      const items = resp.findAll("li");
      expect(items.length).toBe(3);
    });

    test("css('::text') extracts text content", () => {
      const resp = new Response(makeInit());
      const texts = resp.css("h1::text");
      // ::text pseudo-element should yield text node content
      expect(texts.toString()).toContain("Hello");
    });
  });

  // ── JSON body parsing ──────────────────────────────────────────────

  describe("JSON body", () => {
    test("body can be parsed as JSON when response is JSON", () => {
      const jsonBody = JSON.stringify({ name: "scrapling", version: 1 });
      const resp = new Response(
        makeInit({
          body: jsonBody,
          headers: new Headers({ "content-type": "application/json" }),
        }),
      );
      const parsed = JSON.parse(resp.body) as Record<string, unknown>;
      expect(parsed.name).toBe("scrapling");
      expect(parsed.version).toBe(1);
    });

    test("body string is preserved exactly", () => {
      const jsonBody = '{"key":"value"}';
      const resp = new Response(makeInit({ body: jsonBody }));
      expect(resp.body).toBe('{"key":"value"}');
    });
  });

  // ── Readonly properties ────────────────────────────────────────────

  describe("readonly fields", () => {
    test("status is readonly", () => {
      const resp = new Response(makeInit());
      // TypeScript enforces this at compile time; runtime check that value persists
      expect(resp.status).toBe(200);
    });

    test("statusText is readonly", () => {
      const resp = new Response(makeInit());
      expect(resp.statusText).toBe("OK");
    });

    test("cookies is readonly reference", () => {
      const resp = new Response(makeInit({ cookies: { a: "1" } }));
      expect(resp.cookies.a).toBe("1");
    });
  });
});
