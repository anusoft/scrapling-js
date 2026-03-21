/**
 * Core Selector and Selectors engine for scrapling-js.
 *
 * Selector  — wraps a cheerio element, provides Scrapling-style querying API
 * Selectors — extends Array<Selector> with batch operations
 */

import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element, Text as DomText, Document } from "domhandler";
import { ElementType } from "domelementtype";
import { TextHandler, TextHandlers, AttributesHandler } from "./text.js";

// Tags whose text content should be ignored by getAllText
const DEFAULT_IGNORE_TAGS = new Set(["script", "style"]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a pseudo-element suffix from a CSS selector.
 * Handles `::text` and `::attr(name)`.
 *
 * Returns { cleanSelector, pseudo } where pseudo is:
 *   - null        — no pseudo
 *   - "text"      — ::text
 *   - { attr: "name" }  — ::attr(name)
 */
interface PseudoText {
  type: "text";
}
interface PseudoAttr {
  type: "attr";
  name: string;
}
type Pseudo = PseudoText | PseudoAttr | null;

function parsePseudo(selector: string): { cleanSelector: string; pseudo: Pseudo } {
  // Check for ::attr(name) at the end
  const attrMatch = selector.match(/::attr\(([^)]+)\)\s*$/);
  if (attrMatch) {
    return {
      cleanSelector: selector.slice(0, attrMatch.index!).trim() || "*",
      pseudo: { type: "attr", name: attrMatch[1].trim() },
    };
  }

  // Check for ::text at the end
  const textMatch = selector.match(/::text\s*$/);
  if (textMatch) {
    return {
      cleanSelector: selector.slice(0, textMatch.index!).trim() || "*",
      pseudo: { type: "text" },
    };
  }

  return { cleanSelector: selector, pseudo: null };
}

/**
 * Split a compound CSS selector on commas, respecting brackets and parentheses.
 * e.g. "div.a, span[data-x=','], p" => ["div.a", "span[data-x=',']", "p"]
 */
function splitCompoundSelector(selector: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0; // tracks [] and () nesting
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    const prev = i > 0 ? selector[i - 1] : "";

    if (ch === "'" && !inDoubleQuote && prev !== "\\") {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote && prev !== "\\") {
      inDoubleQuote = !inDoubleQuote;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === "[" || ch === "(") {
        depth++;
      } else if (ch === "]" || ch === ")") {
        depth--;
      } else if (ch === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Check if a cheerio node is an Element (tag) node.
 * Element types include Tag, Script, and Style in domhandler.
 */
function isElement(node: AnyNode): node is Element {
  const t = node.type as string;
  return t === "tag" || t === "script" || t === "style";
}

/**
 * Check if a cheerio node is a text node.
 */
function isTextNode(node: AnyNode): node is DomText {
  return (node.type as string) === "text";
}

/**
 * Check if a cheerio node is a Document root.
 */
function isRoot(node: AnyNode): node is Document {
  return (node.type as string) === "root";
}

/**
 * Resolve a URL against a base URL.
 */
function resolveUrl(base: string, relative: string): string {
  if (!base) return relative;
  try {
    return new URL(relative, base).href;
  } catch {
    // If base is not a valid URL, just return relative
    return relative;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Selector
// ─────────────────────────────────────────────────────────────────────────────

export class Selector {
  /** The cheerio API (loaded document) */
  private readonly _$: CheerioAPI;
  /** The wrapped cheerio element */
  private readonly _el: Cheerio<AnyNode>;
  /** Base URL for resolving relative URLs */
  private readonly _url: string;

  /**
   * Create a Selector from an HTML string.
   */
  constructor(html: string, url?: string);
  /**
   * Create a Selector wrapping an existing cheerio element.
   */
  constructor($: CheerioAPI, el: Cheerio<AnyNode>, url?: string);
  constructor(
    htmlOrApi: string | CheerioAPI,
    urlOrEl?: string | Cheerio<AnyNode>,
    maybeUrl?: string,
  ) {
    if (typeof htmlOrApi === "string") {
      // constructor(html, url?)
      this._$ = cheerio.load(htmlOrApi);
      this._el = this._$(this._$.root().children().first());
      this._url = (urlOrEl as string) ?? "";
    } else {
      // constructor($, el, url?)
      this._$ = htmlOrApi;
      this._el = urlOrEl as Cheerio<AnyNode>;
      this._url = maybeUrl ?? "";
    }
  }

  // ── Properties ──────────────────────────────────────────────────────────

  /** Element tag name (lowercase). */
  get tag(): string {
    const node = this._el.get(0);
    if (node && isElement(node)) {
      return node.tagName.toLowerCase();
    }
    return "";
  }

  /**
   * Direct text content of this element (immediate text nodes only).
   * Does NOT include text from descendant elements.
   */
  get text(): TextHandler {
    const node = this._el.get(0);
    if (!node) return new TextHandler("");

    const textParts: string[] = [];
    const children = "childNodes" in node ? (node as Element).childNodes : [];
    for (const child of children) {
      if (isTextNode(child)) {
        textParts.push(child.data);
      }
    }
    return new TextHandler(textParts.join(""));
  }

  /**
   * All descendant text content (cheerio's .text()).
   */
  get allText(): TextHandler {
    return new TextHandler(this._el.text());
  }

  /** Inner HTML of the element. */
  get htmlContent(): string {
    return this._el.html() ?? "";
  }

  /** Outer HTML including the element's own tag. */
  get outerHtml(): string {
    return this._$.html(this._el) ?? "";
  }

  /** Element attributes as an AttributesHandler. */
  get attrib(): AttributesHandler {
    const node = this._el.get(0);
    if (!node || !isElement(node)) return new AttributesHandler();
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(node.attribs as Record<string, string>)) {
      attrs[key] = value;
    }
    return new AttributesHandler(attrs);
  }

  /** Base URL for resolving relative URLs. */
  get url(): string {
    return this._url;
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  /** Parent element, or null if at root. */
  get parent(): Selector | null {
    const parentEl = this._el.parent();
    if (parentEl.length === 0) return null;
    // Don't return the document root as a parent
    const parentNode = parentEl.get(0);
    if (parentNode && isRoot(parentNode)) return null;
    return new Selector(this._$, parentEl, this._url);
  }

  /** Direct child elements (tag nodes only). */
  get children(): Selectors {
    const result = new Selectors();
    this._el.children().each((_i, el) => {
      if (isElement(el)) {
        result.push(new Selector(this._$, this._$(el), this._url));
      }
    });
    return result;
  }

  /** Sibling elements excluding self. */
  get siblings(): Selectors {
    const result = new Selectors();
    const selfNode = this._el.get(0);
    this._el.parent().children().each((_i, el) => {
      if (isElement(el) && el !== selfNode) {
        result.push(new Selector(this._$, this._$(el), this._url));
      }
    });
    return result;
  }

  /** Next sibling element, or null. */
  get next(): Selector | null {
    const nextEl = this._el.next();
    if (nextEl.length === 0) return null;
    return new Selector(this._$, nextEl, this._url);
  }

  /** Previous sibling element, or null. */
  get previous(): Selector | null {
    const prevEl = this._el.prev();
    if (prevEl.length === 0) return null;
    return new Selector(this._$, prevEl, this._url);
  }

  // ── Querying ────────────────────────────────────────────────────────────

  /**
   * Execute a CSS selector query.
   *
   * Supports special pseudo-elements:
   *   - `::text`       — returns TextHandlers of matched elements' text
   *   - `::attr(name)` — returns TextHandlers of matched elements' attribute values
   *
   * Supports compound selectors (comma-separated).
   *
   * Regular selectors return Selectors.
   */
  css(selector: string): Selectors | TextHandlers {
    // Split compound selectors
    const parts = splitCompoundSelector(selector);

    // Check if all parts share the same pseudo type
    const parsedParts = parts.map((p) => parsePseudo(p));

    // Determine if we're in pseudo mode
    const hasPseudo = parsedParts.some((p) => p.pseudo !== null);
    const hasNonPseudo = parsedParts.some((p) => p.pseudo === null);

    // If mixing pseudo and non-pseudo, treat as regular (ignore pseudo)
    // In practice, all parts should agree.

    if (hasPseudo && !hasNonPseudo) {
      // All parts have pseudo — return TextHandlers
      const results: TextHandler[] = [];
      for (const { cleanSelector, pseudo } of parsedParts) {
        const matched = this._query(cleanSelector);
        matched.each((_i, el) => {
          if (pseudo!.type === "text") {
            results.push(new TextHandler(this._$(el).text()));
          } else if (pseudo!.type === "attr") {
            const val = this._$(el).attr(pseudo!.name);
            if (val !== undefined) {
              results.push(new TextHandler(val));
            }
          }
        });
      }
      return new TextHandlers(...results);
    }

    // Regular selector(s) — return Selectors
    const result = new Selectors();
    const seen = new Set<AnyNode>();
    for (const { cleanSelector } of parsedParts) {
      const matched = this._query(cleanSelector);
      matched.each((_i, el) => {
        if (!seen.has(el)) {
          seen.add(el);
          result.push(new Selector(this._$, this._$(el), this._url));
        }
      });
    }
    return result;
  }

  /**
   * Find the first element matching a tag name with optional attributes.
   */
  find(tag: string, attrs?: Record<string, string>): Selector | null {
    const results = this.findAll(tag, attrs);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Find all elements matching a tag name with optional attributes.
   */
  findAll(tag: string, attrs?: Record<string, string>): Selectors {
    let cssSelector = tag;
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") {
          // Support space-separated classes
          const classes = value.split(/\s+/).filter(Boolean);
          for (const cls of classes) {
            cssSelector += `.${cls}`;
          }
        } else if (key === "id") {
          cssSelector += `#${value}`;
        } else {
          cssSelector += `[${key}="${value.replace(/"/g, '\\"')}"]`;
        }
      }
    }

    const matched = this._query(cssSelector);
    const result = new Selectors();
    matched.each((_i, el) => {
      result.push(new Selector(this._$, this._$(el), this._url));
    });
    return result;
  }

  /**
   * Find all elements whose text content matches the given text.
   */
  findByText(
    text: string,
    partial: boolean = true,
    caseSensitive: boolean = true,
  ): Selectors {
    const result = new Selectors();
    const searchText = caseSensitive ? text : text.toLowerCase();

    this._el.find("*").each((_i, el) => {
      if (!isElement(el)) return;
      const elText = this._$(el).text();
      const compareText = caseSensitive ? elText : elText.toLowerCase();

      if (partial ? compareText.includes(searchText) : compareText === searchText) {
        result.push(new Selector(this._$, this._$(el), this._url));
      }
    });
    return result;
  }

  /**
   * Find all elements whose text content matches the given regex pattern.
   */
  findByRegex(pattern: RegExp): Selectors {
    const result = new Selectors();
    this._el.find("*").each((_i, el) => {
      if (!isElement(el)) return;
      const elText = this._$(el).text();
      if (pattern.test(elText)) {
        // Reset lastIndex for global regexps
        pattern.lastIndex = 0;
        result.push(new Selector(this._$, this._$(el), this._url));
      }
    });
    return result;
  }

  // ── Regex ───────────────────────────────────────────────────────────────

  /**
   * Apply a regex to the element's text content and return all matches.
   */
  re(pattern: RegExp): TextHandlers {
    return this.allText.re(pattern);
  }

  /**
   * Apply a regex to the element's text content and return the first match.
   */
  reFirst(pattern: RegExp): TextHandler | null {
    const result = this.re(pattern);
    return result.length > 0 ? result[0] : null;
  }

  // ── Other ───────────────────────────────────────────────────────────────

  /**
   * Get a single attribute value, or null if not present.
   */
  getAttribute(name: string): TextHandler | null {
    const val = this._el.attr(name);
    return val !== undefined ? new TextHandler(val) : null;
  }

  /**
   * Check whether the element has a given CSS class.
   */
  hasClass(className: string): boolean {
    return this._el.hasClass(className);
  }

  /**
   * Get all text content, optionally ignoring certain tags (default: script, style).
   *
   * @param separator  Separator between text fragments (default: " ")
   * @param ignoreTags Tags whose content should be excluded (default: ["script", "style"])
   */
  getAllText(separator: string = " ", ignoreTags?: string[]): string {
    const ignoreSet = ignoreTags
      ? new Set(ignoreTags.map((t) => t.toLowerCase()))
      : DEFAULT_IGNORE_TAGS;

    const parts: string[] = [];
    this._collectText(this._el.get(0)!, parts, ignoreSet);
    return parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join(separator);
  }

  /**
   * Resolve a relative URL against the base URL.
   */
  urljoin(relativeUrl: string): string {
    return resolveUrl(this._url, relativeUrl);
  }

  /**
   * Parse the element's text content as JSON.
   */
  json(): any {
    return JSON.parse(this._el.text());
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Execute a CSS query relative to this element.
   * If the element is the root, search globally. Otherwise search descendants.
   */
  private _query(cssSelector: string): Cheerio<AnyNode> {
    const node = this._el.get(0);
    // If this is the root html element or the root itself, do a global search
    if (node && (isRoot(node) || (isElement(node) && node.tagName.toLowerCase() === "html"))) {
      return this._$(cssSelector);
    }
    return this._el.find(cssSelector);
  }

  /**
   * Recursively collect text from a node tree, skipping ignored tags.
   */
  private _collectText(node: AnyNode, parts: string[], ignoreSet: Set<string>): void {
    if (isTextNode(node)) {
      parts.push(node.data);
      return;
    }
    if (isElement(node)) {
      if (ignoreSet.has(node.tagName.toLowerCase())) return;
      for (const child of node.childNodes) {
        this._collectText(child, parts, ignoreSet);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

export class Selectors extends Array<Selector> {
  constructor(...items: Selector[]) {
    super(...items);
    // Fix prototype chain for subclassed arrays
    Object.setPrototypeOf(this, Selectors.prototype);
  }

  /**
   * Apply a CSS selector across all contained Selectors and flatten results.
   */
  css(selector: string): Selectors | TextHandlers {
    // Determine return type from first element
    const allResults: (Selectors | TextHandlers)[] = [];
    for (const sel of this) {
      allResults.push(sel.css(selector));
    }

    if (allResults.length === 0) {
      // Default to empty Selectors
      return new Selectors();
    }

    // Check if results are TextHandlers or Selectors
    const firstResult = allResults[0];
    if (firstResult instanceof TextHandlers) {
      const merged: TextHandler[] = [];
      for (const r of allResults) {
        for (const item of r as TextHandlers) {
          merged.push(item);
        }
      }
      return new TextHandlers(...merged);
    }

    // Selectors
    const merged = new Selectors();
    const seen = new Set<string>();
    for (const r of allResults) {
      for (const item of r as Selectors) {
        // Deduplicate by outerHtml (imperfect but reasonable)
        const key = item.outerHtml;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
    }
    return merged;
  }

  /** Text content of all elements as TextHandlers. */
  get text(): TextHandlers {
    const results: TextHandler[] = [];
    for (const sel of this) {
      results.push(sel.allText);
    }
    return new TextHandlers(...results);
  }

  /** Apply regex across all elements and return all matches. */
  re(pattern: RegExp): TextHandlers {
    const results: TextHandler[] = [];
    for (const sel of this) {
      const matches = sel.re(pattern);
      for (const m of matches) {
        results.push(m);
      }
    }
    return new TextHandlers(...results);
  }

  /** Apply regex across all elements and return the first match. */
  reFirst(pattern: RegExp): TextHandler | null {
    for (const sel of this) {
      const matches = sel.re(pattern);
      if (matches.length > 0) {
        return matches[0];
      }
    }
    return null;
  }

  /** Return the first Selector, or null if empty. */
  first(): Selector | null {
    return this.length > 0 ? this[0] : null;
  }

  /** Return the last Selector, or null if empty. */
  last(): Selector | null {
    return this.length > 0 ? this[this.length - 1] : null;
  }

  /**
   * Override filter to return Selectors instead of plain Array.
   */
  filter(predicate: (value: Selector, index: number, array: Selector[]) => boolean): Selectors;
  filter(predicate: (value: Selector, index: number, array: Selector[]) => unknown): Selectors {
    const result = new Selectors();
    for (let i = 0; i < this.length; i++) {
      if (predicate(this[i], i, this)) {
        result.push(this[i]);
      }
    }
    return result;
  }

  /**
   * Find elements by text across all contained Selectors.
   */
  findByText(text: string, partial: boolean = true): Selectors {
    const result = new Selectors();
    for (const sel of this) {
      const matches = sel.findByText(text, partial);
      for (const m of matches) {
        result.push(m);
      }
    }
    return result;
  }
}
