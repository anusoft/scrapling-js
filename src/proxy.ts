/**
 * Proxy rotation for scrapling-js.
 *
 * Provides a ProxyRotator class with pluggable rotation strategies,
 * proxy error detection, and support for both string and dict proxy formats.
 */

/** Dict-style proxy configuration with optional authentication. */
export interface ProxyDict {
  server: string;
  username?: string;
  password?: string;
}

/** A proxy can be a URL string or a ProxyDict object. */
export type ProxyType = string | ProxyDict;

/** Rotation strategy: given the proxy list and current index, returns [selectedProxy, nextIndex]. */
export type RotationStrategy = (
  proxies: ProxyType[],
  currentIndex: number,
) => [ProxyType, number];

// Common proxy-related error substrings
const PROXY_ERROR_PATTERNS = [
  "proxy",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "tunnel",
  "socket hang up",
  "407",
  "proxy authentication",
  "connect EHOSTUNREACH",
];

/**
 * Validate that a proxy value is either a non-empty string or a ProxyDict with a server field.
 */
function validateProxy(proxy: ProxyType): void {
  if (typeof proxy === "string") {
    if (proxy.trim() === "") {
      throw new Error("Invalid proxy format: proxy string cannot be empty");
    }
  } else if (typeof proxy === "object" && proxy !== null) {
    if (!proxy.server || typeof proxy.server !== "string" || proxy.server.trim() === "") {
      throw new Error("Invalid proxy format: ProxyDict must have a non-empty 'server' field");
    }
  } else {
    throw new Error("Invalid proxy format: proxy must be a string or ProxyDict object");
  }
}

/**
 * Cyclic rotation strategy.
 *
 * Iterates through proxies in round-robin order, wrapping around at the end.
 */
export function cyclicRotation(
  proxies: ProxyType[],
  currentIndex: number,
): [ProxyType, number] {
  const idx = currentIndex % proxies.length;
  const nextIdx = (idx + 1) % proxies.length;
  return [proxies[idx], nextIdx];
}

/**
 * Check if an error is proxy-related based on its message.
 */
export function isProxyError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return PROXY_ERROR_PATTERNS.some((pattern) => msg.includes(pattern.toLowerCase()));
}

/**
 * Rotates through a list of proxies using a configurable strategy.
 *
 * @example
 * ```ts
 * const rotator = new ProxyRotator(["http://proxy1:8080", "http://proxy2:8080"]);
 * const proxy = rotator.getProxy(); // "http://proxy1:8080"
 * const next = rotator.getProxy();  // "http://proxy2:8080"
 * ```
 */
export class ProxyRotator {
  private _proxies: ProxyType[];
  private _strategy: RotationStrategy;
  private _currentIndex: number;

  /**
   * Create a ProxyRotator.
   *
   * @param proxies - Array of proxy strings or ProxyDict objects.
   * @param strategy - Rotation strategy function. Defaults to cyclicRotation.
   * @throws If the proxies array is empty or contains invalid proxy formats.
   */
  constructor(proxies: ProxyType[], strategy: RotationStrategy = cyclicRotation) {
    if (!proxies || proxies.length === 0) {
      throw new Error("Proxies array cannot be empty");
    }

    // Validate all proxies
    for (const proxy of proxies) {
      validateProxy(proxy);
    }

    this._proxies = [...proxies]; // defensive copy
    this._strategy = strategy;
    this._currentIndex = 0;
  }

  /**
   * Get the next proxy according to the rotation strategy.
   */
  getProxy(): ProxyType {
    const [proxy, nextIndex] = this._strategy(this._proxies, this._currentIndex);
    this._currentIndex = nextIndex;
    return proxy;
  }

  /**
   * Get the list of proxies (defensive copy).
   */
  get proxies(): ProxyType[] {
    return [...this._proxies];
  }

  /**
   * Get the number of proxies.
   */
  get length(): number {
    return this._proxies.length;
  }
}
