import { describe, expect, test } from "bun:test";
import { Selector, Selectors } from "../src/selector.js";
import { TextHandler, TextHandlers } from "../src/text.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test HTML
// ─────────────────────────────────────────────────────────────────────────────

const TEST_HTML = `<html>
<head><title>Test Page</title></head>
<body>
  <div id="products" class="container">
    <div class="product" data-id="1">
      <h3 class="title">Widget A</h3>
      <span class="price">$12.50</span>
      <a href="/product/1">View</a>
    </div>
    <div class="product" data-id="2">
      <h3 class="title">Widget B</h3>
      <span class="price">$8.00</span>
      <a href="/product/2">View</a>
    </div>
    <div class="product special" data-id="3">
      <h3 class="title">Widget C</h3>
      <span class="price">$24.99</span>
      <a href="/product/3">View</a>
      <span class="badge">Sale!</span>
    </div>
  </div>
  <footer><p>Copyright 2025</p></footer>
</body>
</html>`;

// ─────────────────────────────────────────────────────────────────────────────
// CSS Queries
// ─────────────────────────────────────────────────────────────────────────────

describe("Selector — CSS queries", () => {
  test("basic tag selector", () => {
    const page = new Selector(TEST_HTML);
    const titles = page.css("h3") as Selectors;
    expect(titles).toBeInstanceOf(Selectors);
    expect(titles.length).toBe(3);
  });

  test("class selector", () => {
    const page = new Selector(TEST_HTML);
    const products = page.css(".product") as Selectors;
    expect(products.length).toBe(3);
  });

  test("id selector", () => {
    const page = new Selector(TEST_HTML);
    const container = page.css("#products") as Selectors;
    expect(container.length).toBe(1);
    expect(container[0].tag).toBe("div");
  });

  test("attribute selector", () => {
    const page = new Selector(TEST_HTML);
    const items = page.css('[data-id="2"]') as Selectors;
    expect(items.length).toBe(1);
    expect(items[0].allText.toString()).toContain("Widget B");
  });

  test("descendant selector", () => {
    const page = new Selector(TEST_HTML);
    const prices = page.css(".product .price") as Selectors;
    expect(prices.length).toBe(3);
  });

  test("chained css calls", () => {
    const page = new Selector(TEST_HTML);
    const products = page.css(".product") as Selectors;
    const firstProduct = products.first()!;
    const title = firstProduct.css(".title") as Selectors;
    expect(title.length).toBe(1);
    expect(title[0].allText.toString()).toBe("Widget A");
  });

  test("::text pseudo-element", () => {
    const page = new Selector(TEST_HTML);
    const texts = page.css(".title::text") as TextHandlers;
    expect(texts).toBeInstanceOf(TextHandlers);
    expect(texts.length).toBe(3);
    expect(texts[0].toString()).toBe("Widget A");
    expect(texts[1].toString()).toBe("Widget B");
    expect(texts[2].toString()).toBe("Widget C");
  });

  test("::attr(name) pseudo-element", () => {
    const page = new Selector(TEST_HTML);
    const hrefs = page.css("a::attr(href)") as TextHandlers;
    expect(hrefs).toBeInstanceOf(TextHandlers);
    expect(hrefs.length).toBe(3);
    expect(hrefs[0].toString()).toBe("/product/1");
    expect(hrefs[1].toString()).toBe("/product/2");
    expect(hrefs[2].toString()).toBe("/product/3");
  });

  test("::attr(data-id) pseudo-element", () => {
    const page = new Selector(TEST_HTML);
    const ids = page.css(".product::attr(data-id)") as TextHandlers;
    expect(ids.length).toBe(3);
    expect(ids[0].toString()).toBe("1");
    expect(ids[1].toString()).toBe("2");
    expect(ids[2].toString()).toBe("3");
  });

  test("compound selector (comma-separated)", () => {
    const page = new Selector(TEST_HTML);
    const results = page.css("h3, .badge") as Selectors;
    expect(results.length).toBe(4); // 3 h3 + 1 badge
  });

  test("compound selector with ::text", () => {
    const page = new Selector(TEST_HTML);
    const texts = page.css(".title::text, .price::text") as TextHandlers;
    expect(texts).toBeInstanceOf(TextHandlers);
    expect(texts.length).toBe(6); // 3 titles + 3 prices
  });

  test("css returns empty Selectors for no match", () => {
    const page = new Selector(TEST_HTML);
    const result = page.css(".nonexistent") as Selectors;
    expect(result).toBeInstanceOf(Selectors);
    expect(result.length).toBe(0);
  });

  test("css returns empty TextHandlers for no match with ::text", () => {
    const page = new Selector(TEST_HTML);
    const result = page.css(".nonexistent::text") as TextHandlers;
    expect(result).toBeInstanceOf(TextHandlers);
    expect(result.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Properties
// ─────────────────────────────────────────────────────────────────────────────

describe("Selector — properties", () => {
  test("tag property", () => {
    const page = new Selector(TEST_HTML);
    const div = (page.css("#products") as Selectors).first()!;
    expect(div.tag).toBe("div");

    const h3 = (page.css("h3") as Selectors).first()!;
    expect(h3.tag).toBe("h3");
  });

  test("text property (direct text only)", () => {
    // Text with mixed content — direct text should not include descendant text
    const html = "<div>Hello <span>World</span> Goodbye</div>";
    const sel = new Selector(html);
    const div = (sel.css("div") as Selectors).first()!;
    const directText = div.text.toString();
    expect(directText).toContain("Hello");
    expect(directText).toContain("Goodbye");
    expect(directText).not.toContain("World");
  });

  test("allText property (all descendant text)", () => {
    const page = new Selector(TEST_HTML);
    const product = (page.css(".product") as Selectors).first()!;
    const text = product.allText.toString();
    expect(text).toContain("Widget A");
    expect(text).toContain("$12.50");
    expect(text).toContain("View");
  });

  test("htmlContent property", () => {
    const html = "<div><span>Hello</span></div>";
    const sel = new Selector(html);
    const div = (sel.css("div") as Selectors).first()!;
    expect(div.htmlContent).toContain("<span>Hello</span>");
  });

  test("outerHtml property", () => {
    const html = "<div><span>Hello</span></div>";
    const sel = new Selector(html);
    const span = (sel.css("span") as Selectors).first()!;
    expect(span.outerHtml).toBe("<span>Hello</span>");
  });

  test("attrib property", () => {
    const page = new Selector(TEST_HTML);
    const product = (page.css(".product") as Selectors).first()!;
    const attrib = product.attrib;
    expect(attrib.get("class")?.toString()).toBe("product");
    expect(attrib.get("data-id")?.toString()).toBe("1");
  });

  test("url property", () => {
    const page = new Selector(TEST_HTML, "https://example.com");
    expect(page.url).toBe("https://example.com");
  });

  test("url defaults to empty string", () => {
    const page = new Selector(TEST_HTML);
    expect(page.url).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

describe("Selector — navigation", () => {
  test("parent", () => {
    const page = new Selector(TEST_HTML);
    const title = (page.css("h3.title") as Selectors).first()!;
    const parent = title.parent;
    expect(parent).not.toBeNull();
    expect(parent!.tag).toBe("div");
    expect(parent!.hasClass("product")).toBe(true);
  });

  test("children", () => {
    const page = new Selector(TEST_HTML);
    const product = (page.css(".product") as Selectors).first()!;
    const children = product.children;
    expect(children.length).toBe(3); // h3, span, a
    expect(children[0].tag).toBe("h3");
    expect(children[1].tag).toBe("span");
    expect(children[2].tag).toBe("a");
  });

  test("children of third product has 4 children", () => {
    const page = new Selector(TEST_HTML);
    const product = (page.css(".product") as Selectors).last()!;
    const children = product.children;
    expect(children.length).toBe(4); // h3, span, a, span.badge
  });

  test("siblings", () => {
    const page = new Selector(TEST_HTML);
    const title = (page.css("h3.title") as Selectors).first()!;
    const siblings = title.siblings;
    expect(siblings.length).toBe(2); // span.price, a
    expect(siblings[0].tag).toBe("span");
    expect(siblings[1].tag).toBe("a");
  });

  test("next sibling", () => {
    const page = new Selector(TEST_HTML);
    const title = (page.css("h3.title") as Selectors).first()!;
    const next = title.next;
    expect(next).not.toBeNull();
    expect(next!.tag).toBe("span");
    expect(next!.hasClass("price")).toBe(true);
  });

  test("previous sibling", () => {
    const page = new Selector(TEST_HTML);
    const price = (page.css(".price") as Selectors).first()!;
    const prev = price.previous;
    expect(prev).not.toBeNull();
    expect(prev!.tag).toBe("h3");
  });

  test("next returns null when no next sibling", () => {
    const page = new Selector(TEST_HTML);
    const footer = (page.css("footer") as Selectors).first()!;
    // footer's last child is <p>
    const p = (footer.css("p") as Selectors).first()!;
    expect(p.next).toBeNull();
  });

  test("previous returns null when no previous sibling", () => {
    const page = new Selector(TEST_HTML);
    const title = (page.css("h3.title") as Selectors).first()!;
    expect(title.previous).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Find methods
// ─────────────────────────────────────────────────────────────────────────────

describe("Selector — find methods", () => {
  test("find returns first matching element", () => {
    const page = new Selector(TEST_HTML);
    const title = page.find("h3");
    expect(title).not.toBeNull();
    expect(title!.allText.toString()).toBe("Widget A");
  });

  test("find with attrs", () => {
    const page = new Selector(TEST_HTML);
    const product = page.find("div", { "data-id": "2" });
    expect(product).not.toBeNull();
    expect(product!.allText.toString()).toContain("Widget B");
  });

  test("find with class attr", () => {
    const page = new Selector(TEST_HTML);
    const product = page.find("div", { class: "product special" });
    expect(product).not.toBeNull();
    expect(product!.allText.toString()).toContain("Widget C");
  });

  test("find returns null when not found", () => {
    const page = new Selector(TEST_HTML);
    const result = page.find("section");
    expect(result).toBeNull();
  });

  test("findAll returns all matching elements", () => {
    const page = new Selector(TEST_HTML);
    const titles = page.findAll("h3");
    expect(titles.length).toBe(3);
  });

  test("findAll with attrs", () => {
    const page = new Selector(TEST_HTML);
    const products = page.findAll("div", { class: "product" });
    expect(products.length).toBe(3);
  });

  test("findAll returns empty Selectors when not found", () => {
    const page = new Selector(TEST_HTML);
    const result = page.findAll("section");
    expect(result).toBeInstanceOf(Selectors);
    expect(result.length).toBe(0);
  });

  test("findByText with partial match", () => {
    const page = new Selector(TEST_HTML);
    const results = page.findByText("Widget");
    // Should find elements containing "Widget" (h3s + their parents)
    expect(results.length).toBeGreaterThan(0);
    // All h3 titles should be found
    const h3Results = results.filter((s) => s.tag === "h3");
    expect(h3Results.length).toBe(3);
  });

  test("findByText with exact match", () => {
    const page = new Selector(TEST_HTML);
    const results = page.findByText("Widget A", false);
    // Only elements whose entire text is exactly "Widget A"
    expect(results.length).toBeGreaterThanOrEqual(1);
    const h3 = results.filter((s) => s.tag === "h3");
    expect(h3.length).toBe(1);
    expect(h3[0].allText.toString()).toBe("Widget A");
  });

  test("findByText case insensitive", () => {
    const page = new Selector(TEST_HTML);
    const results = page.findByText("widget a", true, false);
    expect(results.length).toBeGreaterThan(0);
  });

  test("findByRegex", () => {
    const page = new Selector(TEST_HTML);
    const results = page.findByRegex(/\$\d+\.\d{2}/);
    // Should find elements containing prices
    expect(results.length).toBeGreaterThan(0);
    const spans = results.filter((s) => s.tag === "span" && s.hasClass("price"));
    expect(spans.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regex methods
// ─────────────────────────────────────────────────────────────────────────────

describe("Selector — regex", () => {
  test("re() returns all matches", () => {
    const page = new Selector(TEST_HTML);
    const container = (page.css("#products") as Selectors).first()!;
    const matches = container.re(/Widget [A-C]/);
    expect(matches).toBeInstanceOf(TextHandlers);
    expect(matches.length).toBe(3);
    expect(matches[0].toString()).toBe("Widget A");
    expect(matches[1].toString()).toBe("Widget B");
    expect(matches[2].toString()).toBe("Widget C");
  });

  test("re() with capture groups", () => {
    const page = new Selector(TEST_HTML);
    const container = (page.css("#products") as Selectors).first()!;
    const matches = container.re(/\$(\d+\.\d{2})/);
    expect(matches.length).toBe(3);
    expect(matches[0].toString()).toBe("12.50");
    expect(matches[1].toString()).toBe("8.00");
    expect(matches[2].toString()).toBe("24.99");
  });

  test("reFirst() returns first match", () => {
    const page = new Selector(TEST_HTML);
    const container = (page.css("#products") as Selectors).first()!;
    const first = container.reFirst(/Widget ([A-C])/);
    expect(first).not.toBeNull();
    expect(first!.toString()).toBe("A");
  });

  test("reFirst() returns null when no match", () => {
    const page = new Selector(TEST_HTML);
    const container = (page.css("#products") as Selectors).first()!;
    const result = container.reFirst(/ZZZ/);
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllText
// ─────────────────────────────────────────────────────────────────────────────

describe("Selector — getAllText", () => {
  test("basic getAllText", () => {
    const page = new Selector(TEST_HTML);
    const footer = (page.css("footer") as Selectors).first()!;
    expect(footer.getAllText()).toBe("Copyright 2025");
  });

  test("getAllText ignores script and style by default", () => {
    const html = `<div>
      <p>Hello</p>
      <script>var x = 1;</script>
      <style>.a { color: red; }</style>
      <p>World</p>
    </div>`;
    const sel = new Selector(html);
    const div = (sel.css("div") as Selectors).first()!;
    const text = div.getAllText();
    expect(text).toContain("Hello");
    expect(text).toContain("World");
    expect(text).not.toContain("var x = 1");
    expect(text).not.toContain("color: red");
  });

  test("getAllText with custom separator", () => {
    const html = "<div><p>Hello</p><p>World</p></div>";
    const sel = new Selector(html);
    const div = (sel.css("div") as Selectors).first()!;
    const text = div.getAllText(" | ");
    expect(text).toBe("Hello | World");
  });

  test("getAllText with custom ignoreTags", () => {
    const html = `<div>
      <p>Hello</p>
      <nav>Navigation</nav>
      <p>World</p>
    </div>`;
    const sel = new Selector(html);
    const div = (sel.css("div") as Selectors).first()!;
    const text = div.getAllText(" ", ["nav"]);
    expect(text).toContain("Hello");
    expect(text).toContain("World");
    expect(text).not.toContain("Navigation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Other methods
// ─────────────────────────────────────────────────────────────────────────────

describe("Selector — other methods", () => {
  test("getAttribute", () => {
    const page = new Selector(TEST_HTML);
    const link = (page.css("a") as Selectors).first()!;
    const href = link.getAttribute("href");
    expect(href).not.toBeNull();
    expect(href!.toString()).toBe("/product/1");
  });

  test("getAttribute returns null for missing attribute", () => {
    const page = new Selector(TEST_HTML);
    const link = (page.css("a") as Selectors).first()!;
    expect(link.getAttribute("data-missing")).toBeNull();
  });

  test("hasClass", () => {
    const page = new Selector(TEST_HTML);
    const special = (page.css('[data-id="3"]') as Selectors).first()!;
    expect(special.hasClass("product")).toBe(true);
    expect(special.hasClass("special")).toBe(true);
    expect(special.hasClass("nonexistent")).toBe(false);
  });

  test("urljoin", () => {
    const page = new Selector(TEST_HTML, "https://example.com/page/1");
    const link = (page.css("a") as Selectors).first()!;
    const href = link.getAttribute("href")!.toString();
    const absolute = link.urljoin(href);
    expect(absolute).toBe("https://example.com/product/1");
  });

  test("urljoin with no base url", () => {
    const page = new Selector(TEST_HTML);
    const link = (page.css("a") as Selectors).first()!;
    const href = link.getAttribute("href")!.toString();
    // Without base URL, should just return relative
    expect(link.urljoin(href)).toBe("/product/1");
  });

  test("json()", () => {
    const html = '<div id="data">{"key": "value", "num": 42}</div>';
    const sel = new Selector(html);
    const div = (sel.css("#data") as Selectors).first()!;
    const parsed = div.json();
    expect(parsed).toEqual({ key: "value", num: 42 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Selectors collection
// ─────────────────────────────────────────────────────────────────────────────

describe("Selectors — collection", () => {
  test("first() and last()", () => {
    const page = new Selector(TEST_HTML);
    const titles = page.css("h3.title") as Selectors;
    expect(titles.first()!.allText.toString()).toBe("Widget A");
    expect(titles.last()!.allText.toString()).toBe("Widget C");
  });

  test("first() returns null on empty", () => {
    const s = new Selectors();
    expect(s.first()).toBeNull();
  });

  test("last() returns null on empty", () => {
    const s = new Selectors();
    expect(s.last()).toBeNull();
  });

  test("css() across all elements", () => {
    const page = new Selector(TEST_HTML);
    const products = page.css(".product") as Selectors;
    const titles = products.css(".title") as Selectors;
    expect(titles.length).toBe(3);
  });

  test("css() with ::text across all elements", () => {
    const page = new Selector(TEST_HTML);
    const products = page.css(".product") as Selectors;
    const texts = products.css(".title::text") as TextHandlers;
    expect(texts).toBeInstanceOf(TextHandlers);
    expect(texts.length).toBe(3);
  });

  test("text property", () => {
    const page = new Selector(TEST_HTML);
    const titles = page.css("h3.title") as Selectors;
    const texts = titles.text;
    expect(texts).toBeInstanceOf(TextHandlers);
    expect(texts.length).toBe(3);
    expect(texts[0].toString()).toBe("Widget A");
    expect(texts[1].toString()).toBe("Widget B");
    expect(texts[2].toString()).toBe("Widget C");
  });

  test("re() across all elements", () => {
    const page = new Selector(TEST_HTML);
    const prices = page.css(".price") as Selectors;
    const matches = prices.re(/\$(\d+\.\d{2})/);
    expect(matches.length).toBe(3);
    expect(matches[0].toString()).toBe("12.50");
    expect(matches[1].toString()).toBe("8.00");
    expect(matches[2].toString()).toBe("24.99");
  });

  test("reFirst() across all elements", () => {
    const page = new Selector(TEST_HTML);
    const prices = page.css(".price") as Selectors;
    const first = prices.reFirst(/\$(\d+\.\d{2})/);
    expect(first).not.toBeNull();
    expect(first!.toString()).toBe("12.50");
  });

  test("reFirst() returns null when no match", () => {
    const page = new Selector(TEST_HTML);
    const prices = page.css(".price") as Selectors;
    const result = prices.reFirst(/ZZZ/);
    expect(result).toBeNull();
  });

  test("filter() returns Selectors instance", () => {
    const page = new Selector(TEST_HTML);
    const products = page.css(".product") as Selectors;
    const filtered = products.filter((s) => s.hasClass("special"));
    expect(filtered).toBeInstanceOf(Selectors);
    expect(filtered.length).toBe(1);
    expect(filtered[0].allText.toString()).toContain("Widget C");
  });

  test("iteration with for...of", () => {
    const page = new Selector(TEST_HTML);
    const titles = page.css("h3.title") as Selectors;
    const names: string[] = [];
    for (const title of titles) {
      names.push(title.allText.toString());
    }
    expect(names).toEqual(["Widget A", "Widget B", "Widget C"]);
  });

  test("map()", () => {
    const page = new Selector(TEST_HTML);
    const titles = page.css("h3.title") as Selectors;
    const names = titles.map((t) => t.allText.toString());
    expect(names).toEqual(["Widget A", "Widget B", "Widget C"]);
  });

  test("findByText across collection", () => {
    const page = new Selector(TEST_HTML);
    const products = page.css(".product") as Selectors;
    const results = products.findByText("Sale!");
    expect(results.length).toBeGreaterThan(0);
  });

  test("length property", () => {
    const page = new Selector(TEST_HTML);
    const products = page.css(".product") as Selectors;
    expect(products.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("Selector — edge cases", () => {
  test("empty HTML", () => {
    const page = new Selector("");
    const result = page.css("div") as Selectors;
    expect(result.length).toBe(0);
  });

  test("plain text HTML", () => {
    const page = new Selector("Hello world");
    // Should not crash
    const result = page.css("div") as Selectors;
    expect(result.length).toBe(0);
  });

  test("selector on nested element", () => {
    const page = new Selector(TEST_HTML);
    const product = (page.css(".product") as Selectors).first()!;
    // CSS on child should only find within that element
    const links = product.css("a") as Selectors;
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("href")!.toString()).toBe("/product/1");
  });

  test("url propagates to child selectors", () => {
    const page = new Selector(TEST_HTML, "https://example.com");
    const link = (page.css("a") as Selectors).first()!;
    expect(link.url).toBe("https://example.com");
    expect(link.urljoin("/product/1")).toBe("https://example.com/product/1");
  });

  test("compound selector with brackets in attribute value", () => {
    const html = '<div class="a">A</div><span data-x="1,2">B</span>';
    const sel = new Selector(html);
    // Comma inside attribute value shouldn't split the selector
    const results = sel.css('[data-x="1,2"]') as Selectors;
    expect(results.length).toBe(1);
    expect(results[0].allText.toString()).toBe("B");
  });

  test("multiple css pseudo with comma compound", () => {
    const page = new Selector(TEST_HTML);
    const attrs = page.css('a::attr(href), .product::attr(data-id)') as TextHandlers;
    expect(attrs).toBeInstanceOf(TextHandlers);
    expect(attrs.length).toBe(6); // 3 hrefs + 3 data-ids
  });

  test("Selector from html without html/body tags", () => {
    const html = '<div class="test"><p>Hello</p></div>';
    const sel = new Selector(html);
    const divs = sel.css("div.test") as Selectors;
    expect(divs.length).toBe(1);
    expect(divs[0].allText.toString()).toBe("Hello");
  });

  test("text property returns TextHandler", () => {
    const page = new Selector(TEST_HTML);
    const title = (page.css("h3.title") as Selectors).first()!;
    expect(title.text).toBeInstanceOf(TextHandler);
    expect(title.text.toString()).toBe("Widget A");
  });

  test("allText returns TextHandler", () => {
    const page = new Selector(TEST_HTML);
    const product = (page.css(".product") as Selectors).first()!;
    expect(product.allText).toBeInstanceOf(TextHandler);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constructor overloads
// ─────────────────────────────────────────────────────────────────────────────

describe("Selector — constructor", () => {
  test("construct from HTML string", () => {
    const sel = new Selector("<div>Hello</div>");
    expect(sel.tag).toBe("html");
  });

  test("construct from HTML string with URL", () => {
    const sel = new Selector("<div>Hello</div>", "https://example.com");
    expect(sel.url).toBe("https://example.com");
  });
});
