import { describe, expect, it } from "bun:test";
import { flatten, cleanSpaces } from "../src/utils";
import { generateHeaders, generateReferer } from "../src/headers";
import {
  cyclicRotation,
  isProxyError,
  ProxyRotator,
  type ProxyType,
  type ProxyDict,
} from "../src/proxy";

// ---------------------------------------------------------------------------
// src/utils.ts
// ---------------------------------------------------------------------------
describe("flatten", () => {
  it("flattens an array of arrays", () => {
    expect(flatten([[1, 2], [3, 4], [5]])).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns empty array for empty input", () => {
    expect(flatten([])).toEqual([]);
  });

  it("handles single nested array", () => {
    expect(flatten([["a", "b"]])).toEqual(["a", "b"]);
  });

  it("handles arrays with empty sub-arrays", () => {
    expect(flatten([[], [1], [], [2, 3], []])).toEqual([1, 2, 3]);
  });

  it("works with string arrays", () => {
    expect(flatten([["foo"], ["bar", "baz"]])).toEqual(["foo", "bar", "baz"]);
  });
});

describe("cleanSpaces", () => {
  it("replaces tabs with spaces", () => {
    expect(cleanSpaces("hello\tworld")).toBe("hello world");
  });

  it("removes carriage returns", () => {
    expect(cleanSpaces("hello\r\nworld")).toBe("hello world");
  });

  it("replaces newlines with spaces", () => {
    expect(cleanSpaces("hello\nworld")).toBe("hello world");
  });

  it("collapses multiple spaces", () => {
    expect(cleanSpaces("hello    world")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(cleanSpaces("  hello world  ")).toBe("hello world");
  });

  it("handles all whitespace types combined", () => {
    expect(cleanSpaces("\t hello \r\n world \t")).toBe("hello world");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(cleanSpaces("  \t\r\n  ")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(cleanSpaces("")).toBe("");
  });

  it("does not modify clean strings", () => {
    expect(cleanSpaces("already clean")).toBe("already clean");
  });
});

// ---------------------------------------------------------------------------
// src/headers.ts
// ---------------------------------------------------------------------------
describe("generateHeaders", () => {
  it("returns an object with User-Agent", () => {
    const headers = generateHeaders();
    expect(headers["User-Agent"]).toBeDefined();
    expect(typeof headers["User-Agent"]).toBe("string");
  });

  it("includes standard headers", () => {
    const headers = generateHeaders();
    expect(headers["Accept"]).toBeDefined();
    expect(headers["Accept-Language"]).toBeDefined();
    expect(headers["Accept-Encoding"]).toBeDefined();
    // Real Chrome does NOT send Cache-Control on a fresh navigation (only on
    // explicit reload). generateHeaders intentionally omits it to avoid a tell.
    expect(headers["Cache-Control"]).toBeUndefined();
    expect(headers["Upgrade-Insecure-Requests"]).toBe("1");
  });

  it("User-Agent contains a known browser identifier", () => {
    // Run multiple times to increase chance of hitting all browsers
    for (let i = 0; i < 50; i++) {
      const ua = generateHeaders()["User-Agent"];
      const hasKnown =
        ua.includes("Chrome/") || ua.includes("Firefox/") || ua.includes("Edg/");
      expect(hasKnown).toBe(true);
    }
  });

  it("User-Agent contains a known OS fragment", () => {
    for (let i = 0; i < 50; i++) {
      const ua = generateHeaders()["User-Agent"];
      const hasOS =
        ua.includes("Windows NT 10.0") ||
        ua.includes("Mac OS X 10_15_7") ||
        ua.includes("Linux x86_64");
      expect(hasOS).toBe(true);
    }
  });

  it("Chromium-based headers include Sec-Ch-Ua when Chrome or Edge", () => {
    // Generate many headers and check consistency
    for (let i = 0; i < 100; i++) {
      const headers = generateHeaders();
      const ua = headers["User-Agent"];
      const isChromium = ua.includes("Chrome/") || ua.includes("Edg/");
      const isFirefox = ua.includes("Firefox/") && !ua.includes("Chrome/");

      if (isChromium && !isFirefox) {
        // Client-hint headers are lowercase on the wire (HTTP/2) and emitted
        // lowercase by generateHeaders / generateChromeHeaders to match real Chrome.
        expect(headers["sec-ch-ua"]).toBeDefined();
        expect(headers["sec-ch-ua-mobile"]).toBe("?0");
        expect(headers["sec-ch-ua-platform"]).toBeDefined();
        expect(headers["Sec-Fetch-Site"]).toBe("none");
        expect(headers["Sec-Fetch-Mode"]).toBe("navigate");
        expect(headers["Sec-Fetch-User"]).toBe("?1");
        expect(headers["Sec-Fetch-Dest"]).toBe("document");
      }

      if (isFirefox) {
        // Client-hint (sec-ch-ua*) headers are Chromium-only — Firefox omits them.
        expect(headers["sec-ch-ua"]).toBeUndefined();
        expect(headers["sec-ch-ua-mobile"]).toBeUndefined();
        // But Firefox (v90+) DOES send Fetch Metadata (Sec-Fetch-*) headers.
        expect(headers["Sec-Fetch-Site"]).toBe("none");
      }
    }
  });

  it("Chrome User-Agent contains correct version range", () => {
    for (let i = 0; i < 50; i++) {
      const ua = generateHeaders()["User-Agent"];
      const chromeMatch = ua.match(/Chrome\/(\d+)\.0\.0\.0 Safari/);
      if (chromeMatch && !ua.includes("Edg/")) {
        const ver = parseInt(chromeMatch[1], 10);
        expect(ver).toBeGreaterThanOrEqual(141);
        expect(ver).toBeLessThanOrEqual(143);
      }
    }
  });

  it("produces varying headers across calls (randomness check)", () => {
    const userAgents = new Set<string>();
    for (let i = 0; i < 100; i++) {
      userAgents.add(generateHeaders()["User-Agent"]);
    }
    // With 3 browsers x 3 versions x 3 OSes = 27 combos, we should get variety
    expect(userAgents.size).toBeGreaterThan(1);
  });
});

describe("generateReferer", () => {
  it("returns Google search URL for normal domain", () => {
    expect(generateReferer("https://example.com/page")).toBe(
      "https://www.google.com/search?q=example.com",
    );
  });

  it("strips www. from domain", () => {
    expect(generateReferer("https://www.example.com/page")).toBe(
      "https://www.google.com/search?q=example.com",
    );
  });

  it("handles subdomains", () => {
    expect(generateReferer("https://blog.example.com")).toBe(
      "https://www.google.com/search?q=blog.example.com",
    );
  });

  it("returns null for localhost", () => {
    expect(generateReferer("http://localhost:3000")).toBeNull();
  });

  it("returns null for 127.0.0.1", () => {
    expect(generateReferer("http://127.0.0.1:8080")).toBeNull();
  });

  it("returns null for ::1", () => {
    expect(generateReferer("http://[::1]:8080")).toBeNull();
  });

  it("returns null for IPv4 addresses", () => {
    expect(generateReferer("http://192.168.1.1")).toBeNull();
    expect(generateReferer("http://10.0.0.1/path")).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(generateReferer("not a url")).toBeNull();
  });

  it("works with http URLs", () => {
    expect(generateReferer("http://example.org")).toBe(
      "https://www.google.com/search?q=example.org",
    );
  });
});

// ---------------------------------------------------------------------------
// src/proxy.ts
// ---------------------------------------------------------------------------
describe("cyclicRotation", () => {
  it("returns first proxy and increments index", () => {
    const proxies = ["http://p1:8080", "http://p2:8080", "http://p3:8080"];
    const [proxy, nextIdx] = cyclicRotation(proxies, 0);
    expect(proxy).toBe("http://p1:8080");
    expect(nextIdx).toBe(1);
  });

  it("wraps around at end of array", () => {
    const proxies = ["http://p1:8080", "http://p2:8080"];
    const [proxy, nextIdx] = cyclicRotation(proxies, 1);
    expect(proxy).toBe("http://p2:8080");
    expect(nextIdx).toBe(0);
  });

  it("handles single proxy", () => {
    const proxies = ["http://p1:8080"];
    const [proxy, nextIdx] = cyclicRotation(proxies, 0);
    expect(proxy).toBe("http://p1:8080");
    expect(nextIdx).toBe(0);
  });

  it("handles index larger than array length", () => {
    const proxies = ["http://a:1", "http://b:2"];
    const [proxy, nextIdx] = cyclicRotation(proxies, 5);
    // 5 % 2 = 1 -> proxies[1], nextIdx = (1+1) % 2 = 0
    expect(proxy).toBe("http://b:2");
    expect(nextIdx).toBe(0);
  });
});

describe("isProxyError", () => {
  it("detects proxy keyword in error message", () => {
    expect(isProxyError(new Error("proxy connection failed"))).toBe(true);
  });

  it("detects ECONNREFUSED", () => {
    expect(isProxyError(new Error("connect ECONNREFUSED 127.0.0.1:8080"))).toBe(true);
  });

  it("detects ECONNRESET", () => {
    expect(isProxyError(new Error("read ECONNRESET"))).toBe(true);
  });

  it("detects ETIMEDOUT", () => {
    expect(isProxyError(new Error("connect ETIMEDOUT"))).toBe(true);
  });

  it("detects tunnel errors", () => {
    expect(isProxyError(new Error("tunnel socket could not be established"))).toBe(true);
  });

  it("detects socket hang up", () => {
    expect(isProxyError(new Error("socket hang up"))).toBe(true);
  });

  it("detects 407 errors", () => {
    expect(isProxyError(new Error("Response code 407 (Proxy Authentication Required)"))).toBe(
      true,
    );
  });

  it("detects proxy authentication errors", () => {
    expect(isProxyError(new Error("proxy authentication required"))).toBe(true);
  });

  it("returns false for non-proxy errors", () => {
    expect(isProxyError(new Error("404 Not Found"))).toBe(false);
    expect(isProxyError(new Error("Internal Server Error"))).toBe(false);
    expect(isProxyError(new Error("DNS resolution failed"))).toBe(false);
  });
});

describe("ProxyRotator", () => {
  it("throws on empty proxies array", () => {
    expect(() => new ProxyRotator([])).toThrow("Proxies array cannot be empty");
  });

  it("throws on invalid proxy format (empty string)", () => {
    expect(() => new ProxyRotator([""])).toThrow("Invalid proxy format");
  });

  it("throws on invalid proxy format (whitespace string)", () => {
    expect(() => new ProxyRotator(["  "])).toThrow("Invalid proxy format");
  });

  it("throws on ProxyDict without server", () => {
    expect(() => new ProxyRotator([{ server: "" } as ProxyDict])).toThrow(
      "Invalid proxy format",
    );
  });

  it("throws on invalid proxy type (number)", () => {
    expect(() => new ProxyRotator([42 as unknown as ProxyType])).toThrow(
      "Invalid proxy format",
    );
  });

  it("creates rotator with string proxies", () => {
    const rotator = new ProxyRotator(["http://p1:8080", "http://p2:8080"]);
    expect(rotator.length).toBe(2);
  });

  it("creates rotator with ProxyDict proxies", () => {
    const rotator = new ProxyRotator([
      { server: "http://p1:8080", username: "user", password: "pass" },
    ]);
    expect(rotator.length).toBe(1);
  });

  it("getProxy returns proxies in cyclic order (default strategy)", () => {
    const rotator = new ProxyRotator(["http://a:1", "http://b:2", "http://c:3"]);
    expect(rotator.getProxy()).toBe("http://a:1");
    expect(rotator.getProxy()).toBe("http://b:2");
    expect(rotator.getProxy()).toBe("http://c:3");
    expect(rotator.getProxy()).toBe("http://a:1"); // wraps around
  });

  it("proxies getter returns a copy", () => {
    const original: ProxyType[] = ["http://p1:8080"];
    const rotator = new ProxyRotator(original);
    const copy = rotator.proxies;
    copy.push("http://injected:9999");
    expect(rotator.length).toBe(1); // original not mutated
  });

  it("length getter returns correct count", () => {
    const rotator = new ProxyRotator(["a:1", "b:2", "c:3", "d:4"]);
    expect(rotator.length).toBe(4);
  });

  it("accepts a custom rotation strategy", () => {
    // Always return the last proxy
    const alwaysLast = (proxies: ProxyType[], _idx: number): [ProxyType, number] => {
      return [proxies[proxies.length - 1], 0];
    };
    const rotator = new ProxyRotator(["http://a:1", "http://b:2"], alwaysLast);
    expect(rotator.getProxy()).toBe("http://b:2");
    expect(rotator.getProxy()).toBe("http://b:2");
    expect(rotator.getProxy()).toBe("http://b:2");
  });

  it("works with mixed string and ProxyDict proxies", () => {
    const proxies: ProxyType[] = [
      "http://p1:8080",
      { server: "http://p2:8080", username: "u", password: "p" },
    ];
    const rotator = new ProxyRotator(proxies);
    expect(rotator.getProxy()).toBe("http://p1:8080");
    const second = rotator.getProxy() as ProxyDict;
    expect(second.server).toBe("http://p2:8080");
    expect(second.username).toBe("u");
  });

  it("does not mutate the original proxies array", () => {
    const original: ProxyType[] = ["http://p1:8080", "http://p2:8080"];
    const rotator = new ProxyRotator(original);
    original.push("http://injected:9999");
    expect(rotator.length).toBe(2); // defensive copy
  });
});
