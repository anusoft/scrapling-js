import { describe, expect, test } from "bun:test";
import { TextHandler, TextHandlers, AttributesHandler } from "../src/text";

// ─────────────────────────────────────────────────────────────────────────────
// TextHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("TextHandler", () => {
  // ── Construction & basic properties ──────────────────────────────────

  test("constructs with a string value", () => {
    const t = new TextHandler("hello");
    expect(t.toString()).toBe("hello");
    expect(t.valueOf()).toBe("hello");
  });

  test("defaults to empty string", () => {
    const t = new TextHandler();
    expect(t.toString()).toBe("");
    expect(t.length).toBe(0);
  });

  test("length returns string length", () => {
    const t = new TextHandler("hello");
    expect(t.length).toBe(5);
  });

  test("valueOf enables loose equality with string", () => {
    const t = new TextHandler("abc");
    // eslint-disable-next-line eqeqeq
    expect(t.valueOf() === "abc").toBe(true);
  });

  // ── clean() ─────────────────────────────────────────────────────────

  describe("clean()", () => {
    test("replaces tabs, carriage returns, newlines with spaces", () => {
      const t = new TextHandler("hello\tworld\r\nfoo");
      expect(t.clean().toString()).toBe("hello world foo");
    });

    test("collapses consecutive whitespace", () => {
      const t = new TextHandler("hello    world");
      expect(t.clean().toString()).toBe("hello world");
    });

    test("trims leading and trailing whitespace", () => {
      const t = new TextHandler("  hello  ");
      expect(t.clean().toString()).toBe("hello");
    });

    test("handles mixed whitespace", () => {
      const t = new TextHandler("\t  hello \n\n  world  \t");
      expect(t.clean().toString()).toBe("hello world");
    });

    test("returns TextHandler instance", () => {
      const t = new TextHandler("hello");
      expect(t.clean()).toBeInstanceOf(TextHandler);
    });

    test("removes HTML entities when removeEntities is true", () => {
      const t = new TextHandler("foo &amp; bar &lt;baz&gt;");
      expect(t.clean(true).toString()).toBe("foo & bar <baz>");
    });

    test("does not remove entities by default", () => {
      const t = new TextHandler("foo &amp; bar");
      expect(t.clean().toString()).toBe("foo &amp; bar");
    });

    test("handles numeric entities", () => {
      const t = new TextHandler("&#65;&#66;&#67;");
      expect(t.clean(true).toString()).toBe("ABC");
    });

    test("handles hex entities", () => {
      const t = new TextHandler("&#x41;&#x42;&#x43;");
      expect(t.clean(true).toString()).toBe("ABC");
    });

    test("handles &nbsp;", () => {
      const t = new TextHandler("hello&nbsp;world");
      // &nbsp; decodes to \u00A0 (non-breaking space), which JS \s matches,
      // so clean() collapses it to a regular space
      expect(t.clean(true).toString()).toBe("hello world");
    });
  });

  // ── json() ──────────────────────────────────────────────────────────

  describe("json()", () => {
    test("parses valid JSON object", () => {
      const t = new TextHandler('{"key": "value", "num": 42}');
      const result = t.json() as Record<string, unknown>;
      expect(result.key).toBe("value");
      expect(result.num).toBe(42);
    });

    test("parses JSON array", () => {
      const t = new TextHandler("[1, 2, 3]");
      expect(t.json()).toEqual([1, 2, 3]);
    });

    test("parses JSON string", () => {
      const t = new TextHandler('"hello"');
      expect(t.json()).toBe("hello");
    });

    test("throws on invalid JSON", () => {
      const t = new TextHandler("not json");
      expect(() => t.json()).toThrow();
    });
  });

  // ── re() ────────────────────────────────────────────────────────────

  describe("re()", () => {
    test("returns all matches with string pattern", () => {
      const t = new TextHandler("foo123bar456baz");
      const result = t.re("\\d+");
      expect(result).toBeInstanceOf(TextHandlers);
      expect(result.length).toBe(2);
      expect(result[0].toString()).toBe("123");
      expect(result[1].toString()).toBe("456");
    });

    test("returns all matches with RegExp pattern", () => {
      const t = new TextHandler("hello world hello universe");
      const result = t.re(/hello/);
      expect(result.length).toBe(2);
      expect(result[0].toString()).toBe("hello");
      expect(result[1].toString()).toBe("hello");
    });

    test("returns captured groups when groups exist", () => {
      const t = new TextHandler("price: $10, tax: $3");
      const result = t.re("\\$(\\d+)");
      expect(result.length).toBe(2);
      expect(result[0].toString()).toBe("10");
      expect(result[1].toString()).toBe("3");
    });

    test("returns multiple capture groups", () => {
      const t = new TextHandler("John:30, Jane:25");
      const result = t.re("(\\w+):(\\d+)");
      expect(result.length).toBe(4);
      expect(result[0].toString()).toBe("John");
      expect(result[1].toString()).toBe("30");
      expect(result[2].toString()).toBe("Jane");
      expect(result[3].toString()).toBe("25");
    });

    test("returns empty TextHandlers when no match", () => {
      const t = new TextHandler("hello world");
      const result = t.re("\\d+");
      expect(result).toBeInstanceOf(TextHandlers);
      expect(result.length).toBe(0);
    });

    test("handles RegExp with global flag already set", () => {
      const t = new TextHandler("aaa bbb aaa");
      const result = t.re(/aaa/g);
      expect(result.length).toBe(2);
    });

    test("handles pattern with no capture groups", () => {
      const t = new TextHandler("cat dog cat");
      const result = t.re("cat");
      expect(result.length).toBe(2);
      expect(result[0].toString()).toBe("cat");
    });

    test("each result element is a TextHandler", () => {
      const t = new TextHandler("abc 123 def 456");
      const result = t.re("\\d+");
      for (const r of result) {
        expect(r).toBeInstanceOf(TextHandler);
      }
    });
  });

  // ── reFirst() ───────────────────────────────────────────────────────

  describe("reFirst()", () => {
    test("returns first match", () => {
      const t = new TextHandler("foo123bar456");
      const result = t.reFirst("\\d+");
      expect(result).toBeInstanceOf(TextHandler);
      expect(result!.toString()).toBe("123");
    });

    test("returns first capture group", () => {
      const t = new TextHandler("price: $10, tax: $3");
      const result = t.reFirst("\\$(\\d+)");
      expect(result!.toString()).toBe("10");
    });

    test("returns undefined when no match and no default", () => {
      const t = new TextHandler("hello");
      const result = t.reFirst("\\d+");
      expect(result).toBeUndefined();
    });

    test("returns default when no match", () => {
      const t = new TextHandler("hello");
      const result = t.reFirst("\\d+", "N/A");
      expect(result).toBeInstanceOf(TextHandler);
      expect(result!.toString()).toBe("N/A");
    });
  });

  // ── String delegation methods ───────────────────────────────────────

  describe("split()", () => {
    test("splits by separator", () => {
      const t = new TextHandler("a,b,c");
      const parts = t.split(",");
      expect(parts).toBeInstanceOf(TextHandlers);
      expect(parts.length).toBe(3);
      expect(parts[0].toString()).toBe("a");
      expect(parts[1].toString()).toBe("b");
      expect(parts[2].toString()).toBe("c");
    });

    test("split with limit", () => {
      const t = new TextHandler("a,b,c,d");
      const parts = t.split(",", 2);
      expect(parts.length).toBe(2);
    });

    test("each part is a TextHandler", () => {
      const t = new TextHandler("hello world");
      const parts = t.split(" ");
      for (const p of parts) {
        expect(p).toBeInstanceOf(TextHandler);
      }
    });
  });

  describe("trim()", () => {
    test("trims whitespace", () => {
      const t = new TextHandler("  hello  ");
      expect(t.trim().toString()).toBe("hello");
    });

    test("returns TextHandler", () => {
      const t = new TextHandler("  x  ");
      expect(t.trim()).toBeInstanceOf(TextHandler);
    });
  });

  describe("trimStart()", () => {
    test("trims leading whitespace", () => {
      const t = new TextHandler("  hello  ");
      expect(t.trimStart().toString()).toBe("hello  ");
    });
  });

  describe("trimEnd()", () => {
    test("trims trailing whitespace", () => {
      const t = new TextHandler("  hello  ");
      expect(t.trimEnd().toString()).toBe("  hello");
    });
  });

  describe("toLowerCase()", () => {
    test("converts to lowercase", () => {
      const t = new TextHandler("HELLO World");
      expect(t.toLowerCase().toString()).toBe("hello world");
    });

    test("returns TextHandler", () => {
      expect(new TextHandler("X").toLowerCase()).toBeInstanceOf(TextHandler);
    });
  });

  describe("toUpperCase()", () => {
    test("converts to uppercase", () => {
      const t = new TextHandler("hello World");
      expect(t.toUpperCase().toString()).toBe("HELLO WORLD");
    });

    test("returns TextHandler", () => {
      expect(new TextHandler("x").toUpperCase()).toBeInstanceOf(TextHandler);
    });
  });

  describe("replace()", () => {
    test("replaces first occurrence with string", () => {
      const t = new TextHandler("foo bar foo");
      expect(t.replace("foo", "baz").toString()).toBe("baz bar foo");
    });

    test("replaces with regex", () => {
      const t = new TextHandler("abc123def");
      expect(t.replace(/\d+/, "NUM").toString()).toBe("abcNUMdef");
    });

    test("returns TextHandler", () => {
      expect(new TextHandler("a").replace("a", "b")).toBeInstanceOf(TextHandler);
    });
  });

  describe("replaceAll()", () => {
    test("replaces all occurrences", () => {
      const t = new TextHandler("foo bar foo baz foo");
      expect(t.replaceAll("foo", "qux").toString()).toBe("qux bar qux baz qux");
    });

    test("returns TextHandler", () => {
      expect(new TextHandler("aa").replaceAll("a", "b")).toBeInstanceOf(TextHandler);
    });
  });

  describe("slice()", () => {
    test("slices string", () => {
      const t = new TextHandler("hello world");
      expect(t.slice(0, 5).toString()).toBe("hello");
    });

    test("negative indices", () => {
      const t = new TextHandler("hello world");
      expect(t.slice(-5).toString()).toBe("world");
    });

    test("returns TextHandler", () => {
      expect(new TextHandler("abc").slice(1)).toBeInstanceOf(TextHandler);
    });
  });

  describe("includes()", () => {
    test("returns true if substring found", () => {
      const t = new TextHandler("hello world");
      expect(t.includes("world")).toBe(true);
    });

    test("returns false if substring not found", () => {
      const t = new TextHandler("hello world");
      expect(t.includes("xyz")).toBe(false);
    });

    test("respects position argument", () => {
      const t = new TextHandler("hello hello");
      expect(t.includes("hello", 6)).toBe(true);
      expect(t.includes("hello", 7)).toBe(false);
    });
  });

  describe("startsWith()", () => {
    test("returns true when starts with prefix", () => {
      const t = new TextHandler("hello world");
      expect(t.startsWith("hello")).toBe(true);
    });

    test("returns false when does not start with prefix", () => {
      const t = new TextHandler("hello world");
      expect(t.startsWith("world")).toBe(false);
    });
  });

  describe("endsWith()", () => {
    test("returns true when ends with suffix", () => {
      const t = new TextHandler("hello world");
      expect(t.endsWith("world")).toBe(true);
    });

    test("returns false when does not end with suffix", () => {
      const t = new TextHandler("hello world");
      expect(t.endsWith("hello")).toBe(false);
    });
  });

  describe("indexOf()", () => {
    test("returns index of substring", () => {
      const t = new TextHandler("hello world");
      expect(t.indexOf("world")).toBe(6);
    });

    test("returns -1 when not found", () => {
      const t = new TextHandler("hello world");
      expect(t.indexOf("xyz")).toBe(-1);
    });

    test("respects position argument", () => {
      const t = new TextHandler("abcabc");
      expect(t.indexOf("abc", 1)).toBe(3);
    });
  });

  describe("match()", () => {
    test("returns match array for pattern", () => {
      const t = new TextHandler("hello 123 world");
      const result = t.match(/\d+/);
      expect(result).not.toBeNull();
      expect(result![0]).toBe("123");
    });

    test("returns null when no match", () => {
      const t = new TextHandler("hello world");
      expect(t.match(/\d+/)).toBeNull();
    });
  });

  describe("charAt()", () => {
    test("returns character at index", () => {
      const t = new TextHandler("hello");
      expect(t.charAt(0)).toBe("h");
      expect(t.charAt(4)).toBe("o");
    });
  });

  describe("concat()", () => {
    test("concatenates strings", () => {
      const t = new TextHandler("hello");
      expect(t.concat(" ", "world").toString()).toBe("hello world");
    });

    test("returns TextHandler", () => {
      expect(new TextHandler("a").concat("b")).toBeInstanceOf(TextHandler);
    });
  });

  describe("repeat()", () => {
    test("repeats string", () => {
      const t = new TextHandler("ab");
      expect(t.repeat(3).toString()).toBe("ababab");
    });

    test("returns TextHandler", () => {
      expect(new TextHandler("x").repeat(2)).toBeInstanceOf(TextHandler);
    });
  });

  describe("padStart()", () => {
    test("pads the start of the string", () => {
      const t = new TextHandler("5");
      expect(t.padStart(3, "0").toString()).toBe("005");
    });

    test("returns TextHandler", () => {
      expect(new TextHandler("x").padStart(3)).toBeInstanceOf(TextHandler);
    });
  });

  describe("padEnd()", () => {
    test("pads the end of the string", () => {
      const t = new TextHandler("5");
      expect(t.padEnd(3, "0").toString()).toBe("500");
    });

    test("returns TextHandler", () => {
      expect(new TextHandler("x").padEnd(3)).toBeInstanceOf(TextHandler);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TextHandlers
// ─────────────────────────────────────────────────────────────────────────────

describe("TextHandlers", () => {
  test("extends Array", () => {
    const handlers = new TextHandlers(
      new TextHandler("a"),
      new TextHandler("b"),
    );
    expect(handlers).toBeInstanceOf(Array);
    expect(handlers.length).toBe(2);
  });

  test("elements are TextHandler instances", () => {
    const handlers = new TextHandlers(
      new TextHandler("x"),
      new TextHandler("y"),
    );
    expect(handlers[0]).toBeInstanceOf(TextHandler);
    expect(handlers[1]).toBeInstanceOf(TextHandler);
  });

  // ── re() ────────────────────────────────────────────────────────────

  describe("re()", () => {
    test("applies regex across all elements", () => {
      const handlers = new TextHandlers(
        new TextHandler("foo123"),
        new TextHandler("bar456"),
      );
      const result = handlers.re("\\d+");
      expect(result).toBeInstanceOf(TextHandlers);
      expect(result.length).toBe(2);
      expect(result[0].toString()).toBe("123");
      expect(result[1].toString()).toBe("456");
    });

    test("flattens capture group results", () => {
      const handlers = new TextHandlers(
        new TextHandler("name:John"),
        new TextHandler("name:Jane"),
      );
      const result = handlers.re("name:(\\w+)");
      expect(result.length).toBe(2);
      expect(result[0].toString()).toBe("John");
      expect(result[1].toString()).toBe("Jane");
    });

    test("returns empty TextHandlers when no matches", () => {
      const handlers = new TextHandlers(
        new TextHandler("abc"),
        new TextHandler("def"),
      );
      const result = handlers.re("\\d+");
      expect(result).toBeInstanceOf(TextHandlers);
      expect(result.length).toBe(0);
    });
  });

  // ── reFirst() ───────────────────────────────────────────────────────

  describe("reFirst()", () => {
    test("returns first match across all elements", () => {
      const handlers = new TextHandlers(
        new TextHandler("abc"),
        new TextHandler("def123"),
      );
      const result = handlers.reFirst("\\d+");
      expect(result).toBeInstanceOf(TextHandler);
      expect(result!.toString()).toBe("123");
    });

    test("returns first element's match when multiple match", () => {
      const handlers = new TextHandlers(
        new TextHandler("foo111"),
        new TextHandler("bar222"),
      );
      const result = handlers.reFirst("\\d+");
      expect(result!.toString()).toBe("111");
    });

    test("returns undefined when no match and no default", () => {
      const handlers = new TextHandlers(
        new TextHandler("abc"),
        new TextHandler("def"),
      );
      expect(handlers.reFirst("\\d+")).toBeUndefined();
    });

    test("returns default when no match", () => {
      const handlers = new TextHandlers(
        new TextHandler("abc"),
      );
      const result = handlers.reFirst("\\d+", "none");
      expect(result!.toString()).toBe("none");
    });
  });

  // ── first() / last() ───────────────────────────────────────────────

  describe("first()", () => {
    test("returns first element", () => {
      const handlers = new TextHandlers(
        new TextHandler("first"),
        new TextHandler("second"),
      );
      expect(handlers.first()!.toString()).toBe("first");
    });

    test("returns undefined for empty list", () => {
      const handlers = new TextHandlers();
      expect(handlers.first()).toBeUndefined();
    });
  });

  describe("last()", () => {
    test("returns last element", () => {
      const handlers = new TextHandlers(
        new TextHandler("first"),
        new TextHandler("second"),
        new TextHandler("third"),
      );
      expect(handlers.last()!.toString()).toBe("third");
    });

    test("returns undefined for empty list", () => {
      const handlers = new TextHandlers();
      expect(handlers.last()).toBeUndefined();
    });
  });

  // ── Array operations ────────────────────────────────────────────────

  test("supports iteration", () => {
    const handlers = new TextHandlers(
      new TextHandler("a"),
      new TextHandler("b"),
      new TextHandler("c"),
    );
    const values: string[] = [];
    for (const h of handlers) {
      values.push(h.toString());
    }
    expect(values).toEqual(["a", "b", "c"]);
  });

  test("supports indexing", () => {
    const handlers = new TextHandlers(
      new TextHandler("x"),
      new TextHandler("y"),
    );
    expect(handlers[0].toString()).toBe("x");
    expect(handlers[1].toString()).toBe("y");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AttributesHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("AttributesHandler", () => {
  // ── Construction ────────────────────────────────────────────────────

  test("constructs from plain object", () => {
    const attrs = new AttributesHandler({ class: "main", id: "header" });
    expect(attrs.size).toBe(2);
  });

  test("constructs from Map", () => {
    const map = new Map<string, string>([
      ["href", "https://example.com"],
      ["target", "_blank"],
    ]);
    const attrs = new AttributesHandler(map);
    expect(attrs.size).toBe(2);
  });

  test("constructs with no arguments", () => {
    const attrs = new AttributesHandler();
    expect(attrs.size).toBe(0);
  });

  test("values are TextHandler instances", () => {
    const attrs = new AttributesHandler({ foo: "bar" });
    expect(attrs.get("foo")).toBeInstanceOf(TextHandler);
  });

  // ── get() ───────────────────────────────────────────────────────────

  describe("get()", () => {
    test("returns TextHandler for existing key", () => {
      const attrs = new AttributesHandler({ class: "btn primary" });
      const value = attrs.get("class");
      expect(value).toBeInstanceOf(TextHandler);
      expect(value!.toString()).toBe("btn primary");
    });

    test("returns undefined for missing key", () => {
      const attrs = new AttributesHandler({ class: "btn" });
      expect(attrs.get("id")).toBeUndefined();
    });
  });

  // ── has() ───────────────────────────────────────────────────────────

  describe("has()", () => {
    test("returns true for existing key", () => {
      const attrs = new AttributesHandler({ class: "btn" });
      expect(attrs.has("class")).toBe(true);
    });

    test("returns false for missing key", () => {
      const attrs = new AttributesHandler({ class: "btn" });
      expect(attrs.has("id")).toBe(false);
    });
  });

  // ── keys() / values() / entries() ──────────────────────────────────

  describe("keys()", () => {
    test("returns all keys", () => {
      const attrs = new AttributesHandler({ a: "1", b: "2", c: "3" });
      expect([...attrs.keys()]).toEqual(["a", "b", "c"]);
    });
  });

  describe("values()", () => {
    test("returns all values as TextHandlers", () => {
      const attrs = new AttributesHandler({ a: "1", b: "2" });
      const values = [...attrs.values()];
      expect(values.length).toBe(2);
      expect(values[0]).toBeInstanceOf(TextHandler);
      expect(values[0].toString()).toBe("1");
      expect(values[1].toString()).toBe("2");
    });
  });

  describe("entries()", () => {
    test("returns all key-value pairs", () => {
      const attrs = new AttributesHandler({ x: "10", y: "20" });
      const entries = [...attrs.entries()];
      expect(entries.length).toBe(2);
      expect(entries[0][0]).toBe("x");
      expect(entries[0][1].toString()).toBe("10");
      expect(entries[1][0]).toBe("y");
      expect(entries[1][1].toString()).toBe("20");
    });
  });

  // ── size ────────────────────────────────────────────────────────────

  describe("size", () => {
    test("returns correct count", () => {
      const attrs = new AttributesHandler({ a: "1", b: "2", c: "3" });
      expect(attrs.size).toBe(3);
    });

    test("returns 0 for empty", () => {
      const attrs = new AttributesHandler();
      expect(attrs.size).toBe(0);
    });
  });

  // ── searchValues() ─────────────────────────────────────────────────

  describe("searchValues()", () => {
    test("exact match", () => {
      const attrs = new AttributesHandler({
        class: "btn",
        id: "submit-btn",
        type: "btn",
      });
      const results = attrs.searchValues("btn");
      expect(results.length).toBe(2);
      expect(results[0].get("class")!.toString()).toBe("btn");
      expect(results[1].get("type")!.toString()).toBe("btn");
    });

    test("partial match", () => {
      const attrs = new AttributesHandler({
        class: "btn primary",
        id: "submit-btn",
        type: "text",
      });
      const results = attrs.searchValues("btn", true);
      expect(results.length).toBe(2);
      // "btn primary" contains "btn"
      expect(results[0].get("class")!.toString()).toBe("btn primary");
      // "submit-btn" contains "btn"
      expect(results[1].get("id")!.toString()).toBe("submit-btn");
    });

    test("no matches returns empty array", () => {
      const attrs = new AttributesHandler({ class: "main", id: "header" });
      expect(attrs.searchValues("xyz")).toEqual([]);
    });

    test("each result is an AttributesHandler", () => {
      const attrs = new AttributesHandler({ a: "val", b: "val" });
      const results = attrs.searchValues("val");
      for (const r of results) {
        expect(r).toBeInstanceOf(AttributesHandler);
        expect(r.size).toBe(1);
      }
    });
  });

  // ── toJSON() ────────────────────────────────────────────────────────

  describe("toJSON()", () => {
    test("returns plain object", () => {
      const attrs = new AttributesHandler({ class: "btn", id: "main" });
      const json = attrs.toJSON();
      expect(json).toEqual({ class: "btn", id: "main" });
    });

    test("returns empty object for empty attrs", () => {
      const attrs = new AttributesHandler();
      expect(attrs.toJSON()).toEqual({});
    });

    test("values are plain strings, not TextHandlers", () => {
      const attrs = new AttributesHandler({ key: "value" });
      const json = attrs.toJSON();
      expect(typeof json.key).toBe("string");
    });
  });

  // ── Symbol.iterator ────────────────────────────────────────────────

  describe("Symbol.iterator", () => {
    test("supports for..of iteration", () => {
      const attrs = new AttributesHandler({ a: "1", b: "2" });
      const collected: [string, string][] = [];
      for (const [key, value] of attrs) {
        collected.push([key, value.toString()]);
      }
      expect(collected).toEqual([
        ["a", "1"],
        ["b", "2"],
      ]);
    });

    test("supports spread operator", () => {
      const attrs = new AttributesHandler({ x: "10" });
      const entries = [...attrs];
      expect(entries.length).toBe(1);
      expect(entries[0][0]).toBe("x");
      expect(entries[0][1].toString()).toBe("10");
    });
  });

  // ── toString() ─────────────────────────────────────────────────────

  describe("toString()", () => {
    test("returns JSON string", () => {
      const attrs = new AttributesHandler({ a: "1" });
      const str = attrs.toString();
      expect(JSON.parse(str)).toEqual({ a: "1" });
    });
  });
});
