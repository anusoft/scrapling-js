import { describe, test, expect } from "bun:test";
import { Fetcher, Selector, Selectors, TextHandler, TextHandlers } from "../src/index";

describe("integration: parse local HTML", () => {
  const HTML = `
  <html>
  <body>
    <ul id="menu">
      <li class="item active"><a href="/home">Home</a></li>
      <li class="item"><a href="/about">About</a></li>
      <li class="item"><a href="/contact">Contact</a></li>
    </ul>
    <div class="content">
      <h1>Welcome</h1>
      <p class="intro">Hello <strong>World</strong></p>
      <script>var x = 1;</script>
    </div>
  </body>
  </html>`;

  test("full scraping workflow", () => {
    const page = new Selector(HTML);

    // CSS queries with ::attr pseudo
    const links = page.css("a::attr(href)");
    expect(links).toBeInstanceOf(TextHandlers);
    expect(links.length).toBe(3);
    expect(links[0].toString()).toBe("/home");
    expect(links[1].toString()).toBe("/about");
    expect(links[2].toString()).toBe("/contact");

    // Chaining: Selectors.css with ::text
    const menuTexts = page.css("#menu").css("a::text");
    expect(menuTexts.length).toBe(3);
    expect(menuTexts[1].toString()).toBe("About");

    // Navigation
    const firstItem = page.css(".item").first();
    expect(firstItem).not.toBeNull();
    expect(firstItem!.hasClass("active")).toBe(true);
    const nextItem = firstItem!.next;
    expect(nextItem).not.toBeNull();
    const nextText = nextItem!.css("a::text");
    expect(nextText[0].toString()).toBe("About");

    // findByText — matches all elements containing "Welcome" (body, div, h1)
    // Use exact match (partial=false) to find just the h1
    const welcome = page.findByText("Welcome", false);
    expect(welcome.length).toBeGreaterThan(0);
    expect(welcome.first()!.tag).toBe("h1");

    // getAllText ignores script
    const content = page.css(".content").first();
    expect(content).not.toBeNull();
    const text = content!.getAllText();
    expect(text).toContain("Welcome");
    expect(text).toContain("Hello");
    expect(text).not.toContain("var x");

    // Regex
    const intro = page.css(".intro").first();
    expect(intro).not.toBeNull();
    const words = intro!.allText.re(/\w+/g);
    expect(words.length).toBeGreaterThanOrEqual(2);
  });

  test("Selectors.filter returns Selectors", () => {
    const page = new Selector(HTML);
    const items = page.css(".item");
    expect(items).toBeInstanceOf(Selectors);
    const active = items.filter(el => el.hasClass("active"));
    expect(active).toBeInstanceOf(Selectors);
    expect(active.length).toBe(1);
  });

  test("Selectors.map works", () => {
    const page = new Selector(HTML);
    const hrefs = page.css("a").map(el => el.attrib.get("href")?.toString() ?? "");
    expect(hrefs).toEqual(["/home", "/about", "/contact"]);
  });

  test("parent/children navigation", () => {
    const page = new Selector(HTML);
    const a = page.css("a").first()!;
    expect(a.parent?.tag).toBe("li");
    expect(a.parent?.hasClass("item")).toBe(true);
    const ul = page.css("#menu").first()!;
    expect(ul.children.length).toBe(3);
  });

  test("attribute selectors", () => {
    const page = new Selector(HTML);
    const active = page.css(".item.active");
    expect(active.length).toBe(1);
    expect(active.first()!.css("a::text")[0].toString()).toBe("Home");
  });
});

describe("integration: Fetcher.get real page", () => {
  test("fetch and parse example.com", async () => {
    const page = await Fetcher.get("https://example.com");
    expect(page.status).toBe(200);
    expect(page.ok).toBe(true);

    const title = page.css("title::text");
    expect(title.length).toBe(1);
    expect(title[0].toString()).toContain("Example Domain");

    const h1 = page.css("h1::text");
    expect(h1[0].toString()).toContain("Example Domain");

    const links = page.css("a::attr(href)");
    expect(links.length).toBeGreaterThan(0);
  });

  test("fetch returns proper Response with headers", async () => {
    const page = await Fetcher.get("https://example.com");
    expect(page.headers).toBeInstanceOf(Headers);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.body.length).toBeGreaterThan(100);
    expect(page.url).toContain("example.com");
  });
});
