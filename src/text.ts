/**
 * Text handling classes for scrapling-js.
 *
 * TextHandler   — wraps a string value using composition (not extending String)
 * TextHandlers  — extends Array<TextHandler> with regex helpers and first/last
 * AttributesHandler — wraps a Map<string, TextHandler> with search/iteration
 */

// Regex to collapse consecutive whitespace into a single space
const CONSECUTIVE_SPACES_RE = /\s{2,}/g;

// HTML entity map for common named entities
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&copy;": "\u00A9",
  "&reg;": "\u00AE",
  "&trade;": "\u2122",
  "&ndash;": "\u2013",
  "&mdash;": "\u2014",
  "&lsquo;": "\u2018",
  "&rsquo;": "\u2019",
  "&ldquo;": "\u201C",
  "&rdquo;": "\u201D",
  "&bull;": "\u2022",
  "&hellip;": "\u2026",
};

/**
 * Replace HTML character entity references with their corresponding characters.
 */
function replaceEntities(text: string): string {
  // Replace named entities
  let result = text.replace(/&[a-zA-Z]+;/g, (match) => {
    return HTML_ENTITIES[match] ?? match;
  });
  // Replace numeric (decimal) entities
  result = result.replace(/&#(\d+);/g, (_match, digits: string) => {
    return String.fromCharCode(parseInt(digits, 10));
  });
  // Replace numeric (hex) entities
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// TextHandler
// ─────────────────────────────────────────────────────────────────────────────

export class TextHandler {
  private readonly _value: string;

  constructor(value: string = "") {
    this._value = value;
  }

  /** Return the underlying string value. */
  toString(): string {
    return this._value;
  }

  /** Return the underlying string as a primitive value (enables == comparisons). */
  valueOf(): string {
    return this._value;
  }

  /** Length of the underlying string. */
  get length(): number {
    return this._value.length;
  }

  // ── Cleaning ────────────────────────────────────────────────────────────

  /**
   * Return a cleaned version of the string: tabs/CR/LF replaced by spaces,
   * consecutive whitespace collapsed, and the result trimmed.
   *
   * @param removeEntities If true, HTML entities are decoded first.
   */
  clean(removeEntities: boolean = false): TextHandler {
    let data = this._value.replace(/[\t\r\n]/g, " ");
    if (removeEntities) {
      data = replaceEntities(data);
    }
    return new TextHandler(data.replace(CONSECUTIVE_SPACES_RE, " ").trim());
  }

  // ── JSON ────────────────────────────────────────────────────────────────

  /**
   * Parse the string as JSON and return the resulting object.
   */
  json(): unknown {
    return JSON.parse(this._value);
  }

  // ── Regex ───────────────────────────────────────────────────────────────

  /**
   * Apply a regex pattern and return all matches as a TextHandlers list.
   *
   * If the pattern contains capture groups, the captured groups are returned
   * (flattened). Otherwise, the full matches are returned.
   *
   * The global flag is always added internally so all matches are found.
   */
  re(pattern: string | RegExp): TextHandlers {
    const re = ensureGlobal(pattern);
    const results: TextHandler[] = [];
    let m: RegExpExecArray | null;

    while ((m = re.exec(this._value)) !== null) {
      if (m.length > 1) {
        // Has capture groups — push each captured group
        for (let i = 1; i < m.length; i++) {
          if (m[i] !== undefined) {
            results.push(new TextHandler(m[i]));
          }
        }
      } else {
        // No capture groups — push full match
        results.push(new TextHandler(m[0]));
      }
    }

    return new TextHandlers(...results);
  }

  /**
   * Apply a regex pattern and return the first match (first capture group
   * if groups exist, otherwise the full match). Returns `defaultValue` if
   * nothing matched.
   */
  reFirst(pattern: string | RegExp, defaultValue?: string): TextHandler | undefined {
    const result = this.re(pattern);
    if (result.length > 0) {
      return result[0];
    }
    return defaultValue !== undefined ? new TextHandler(defaultValue) : undefined;
  }

  // ── String delegation methods ───────────────────────────────────────────

  split(separator?: string | RegExp, limit?: number): TextHandlers {
    const parts = this._value.split(separator as string, limit);
    return new TextHandlers(...parts.map((s) => new TextHandler(s)));
  }

  trim(): TextHandler {
    return new TextHandler(this._value.trim());
  }

  trimStart(): TextHandler {
    return new TextHandler(this._value.trimStart());
  }

  trimEnd(): TextHandler {
    return new TextHandler(this._value.trimEnd());
  }

  toLowerCase(): TextHandler {
    return new TextHandler(this._value.toLowerCase());
  }

  toUpperCase(): TextHandler {
    return new TextHandler(this._value.toUpperCase());
  }

  replace(
    searchValue: string | RegExp,
    replaceValue: string,
  ): TextHandler {
    return new TextHandler(this._value.replace(searchValue, replaceValue));
  }

  replaceAll(
    searchValue: string | RegExp,
    replaceValue: string,
  ): TextHandler {
    return new TextHandler(this._value.replaceAll(searchValue, replaceValue));
  }

  slice(start?: number, end?: number): TextHandler {
    return new TextHandler(this._value.slice(start, end));
  }

  includes(searchString: string, position?: number): boolean {
    return this._value.includes(searchString, position);
  }

  startsWith(searchString: string, position?: number): boolean {
    return this._value.startsWith(searchString, position);
  }

  endsWith(searchString: string, endPosition?: number): boolean {
    return this._value.endsWith(searchString, endPosition);
  }

  indexOf(searchString: string, position?: number): number {
    return this._value.indexOf(searchString, position);
  }

  match(regexp: string | RegExp): RegExpMatchArray | null {
    return this._value.match(regexp);
  }

  charAt(index: number): string {
    return this._value.charAt(index);
  }

  concat(...strings: string[]): TextHandler {
    return new TextHandler(this._value.concat(...strings));
  }

  repeat(count: number): TextHandler {
    return new TextHandler(this._value.repeat(count));
  }

  padStart(maxLength: number, fillString?: string): TextHandler {
    return new TextHandler(this._value.padStart(maxLength, fillString));
  }

  padEnd(maxLength: number, fillString?: string): TextHandler {
    return new TextHandler(this._value.padEnd(maxLength, fillString));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TextHandlers
// ─────────────────────────────────────────────────────────────────────────────

export class TextHandlers extends Array<TextHandler> {
  /**
   * Apply a regex across every element and return flattened results.
   */
  re(pattern: string | RegExp): TextHandlers {
    const results: TextHandler[] = [];
    for (const handler of this) {
      const matches = handler.re(pattern);
      for (const m of matches) {
        results.push(m);
      }
    }
    return new TextHandlers(...results);
  }

  /**
   * Apply a regex across every element and return the very first match,
   * or `defaultValue` if nothing matched.
   */
  reFirst(pattern: string | RegExp, defaultValue?: string): TextHandler | undefined {
    for (const handler of this) {
      const matches = handler.re(pattern);
      if (matches.length > 0) {
        return matches[0];
      }
    }
    return defaultValue !== undefined ? new TextHandler(defaultValue) : undefined;
  }

  /** Return the first element, or undefined if the list is empty. */
  first(): TextHandler | undefined {
    return this.length > 0 ? this[0] : undefined;
  }

  /** Return the last element, or undefined if the list is empty. */
  last(): TextHandler | undefined {
    return this.length > 0 ? this[this.length - 1] : undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AttributesHandler
// ─────────────────────────────────────────────────────────────────────────────

export class AttributesHandler {
  private readonly _data: Map<string, TextHandler>;

  constructor(attrs?: Record<string, string> | Map<string, string> | Iterable<[string, string]>) {
    this._data = new Map<string, TextHandler>();
    if (attrs) {
      if (attrs instanceof Map) {
        for (const [key, value] of attrs) {
          this._data.set(key, new TextHandler(value));
        }
      } else if (Symbol.iterator in Object(attrs)) {
        for (const [key, value] of attrs as Iterable<[string, string]>) {
          this._data.set(key, new TextHandler(value));
        }
      } else {
        // Plain object
        for (const [key, value] of Object.entries(attrs as Record<string, string>)) {
          this._data.set(key, new TextHandler(value));
        }
      }
    }
  }

  /** Get a value by key, or undefined if the key does not exist. */
  get(key: string): TextHandler | undefined {
    return this._data.get(key);
  }

  /** Check whether a key exists. */
  has(key: string): boolean {
    return this._data.has(key);
  }

  /** Return all attribute keys. */
  keys(): IterableIterator<string> {
    return this._data.keys();
  }

  /** Return all attribute values (as TextHandler instances). */
  values(): IterableIterator<TextHandler> {
    return this._data.values();
  }

  /** Return all key-value pairs. */
  entries(): IterableIterator<[string, TextHandler]> {
    return this._data.entries();
  }

  /** Number of attributes. */
  get size(): number {
    return this._data.size;
  }

  /**
   * Search attribute values for a keyword.
   *
   * @param keyword  The string to search for.
   * @param partial  If true, matches values that *contain* the keyword.
   *                 If false (default), only exact matches.
   * @returns An array of `AttributesHandler` instances, each containing a single matching pair.
   */
  searchValues(keyword: string, partial: boolean = false): AttributesHandler[] {
    const results: AttributesHandler[] = [];
    for (const [key, value] of this._data) {
      const strValue = value.toString();
      if (partial ? strValue.includes(keyword) : strValue === keyword) {
        results.push(new AttributesHandler({ [key]: strValue }));
      }
    }
    return results;
  }

  /**
   * Convert the attributes to a plain JSON-serialisable object.
   */
  toJSON(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [key, value] of this._data) {
      obj[key] = value.toString();
    }
    return obj;
  }

  /** Make AttributesHandler iterable via for..of (yields [key, TextHandler] pairs). */
  [Symbol.iterator](): IterableIterator<[string, TextHandler]> {
    return this._data.entries();
  }

  toString(): string {
    return JSON.stringify(this.toJSON());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure a regex has the global flag set so that exec / matchAll find all matches.
 */
function ensureGlobal(pattern: string | RegExp): RegExp {
  if (typeof pattern === "string") {
    return new RegExp(pattern, "g");
  }
  if (pattern.global) {
    // Return a fresh copy to reset lastIndex
    return new RegExp(pattern.source, pattern.flags);
  }
  return new RegExp(pattern.source, pattern.flags + "g");
}
