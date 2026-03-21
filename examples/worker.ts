/**
 * scrapling-js Cloudflare Worker
 *
 * Routes:
 *   GET  /                              — Usage docs
 *   GET  /scrape?url=...&selector=...   — CSS selector extraction (JSON or markdown via Accept header)
 *   GET  /markdown?url=...              — HTML→Markdown via node-html-markdown
 *   GET  /markdown?url=...&engine=ai    — HTML→Markdown via Workers AI
 *   POST /markdown                      — Convert HTML body → Markdown
 *   GET  /health                        — Health check
 *
 * Smart routing:
 *   - Detects SPA/thin content pages that need browser rendering
 *   - If LOCAL_APP_URL is configured, proxies browser-needed requests to local app
 *   - Otherwise returns { needs_browser: true } signal for caller to handle
 *
 * Content negotiation:
 *   Accept: text/markdown on /scrape returns markdown instead of JSON
 */
import { Fetcher } from "../src/index";
import { NodeHtmlMarkdown } from "node-html-markdown";
import {
  type Env,
  type AuthUser,
  authenticateRequest,
  createAuth,
  isAdmin,
} from "./auth";
import type { createReactAuth } from "@1moby/just-auth";

type AuthInstance = ReturnType<typeof createReactAuth>;

const nhm = new NodeHtmlMarkdown({ codeBlockStyle: "fenced" });

// ── SPA / thin content detection ───────────────────────────────────────────

const SPA_SIGNALS: Array<[RegExp, string]> = [
  [/<script[^>]*id="__NEXT_DATA__"/i, "Next.js"],
  [/\/_next\/static\//i, "Next.js"],
  [/"buildId":/i, "Next.js"],
  [/<div\s+id="root"\s*>\s*<\/div>/i, "React"],
  [/<div\s+id="app"\s*>\s*<\/div>/i, "React/Vue"],
  [/react\.production\.min\.js/i, "React"],
  [/react-dom/i, "React"],
  [/vue\.runtime/i, "Vue.js"],
  [/<div\s+id="__nuxt"/i, "Nuxt.js"],
  [/\/_nuxt\//i, "Nuxt.js"],
  [/ng-version=/i, "Angular"],
  [/<app-root/i, "Angular"],
  [/__sveltekit/i, "SvelteKit"],
  [/___gatsby/i, "Gatsby"],
];

function detectSpa(html: string): string | null {
  for (const [pattern, framework] of SPA_SIGNALS) {
    if (pattern.test(html)) return framework;
  }
  return null;
}

function isThinContent(html: string): boolean {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.length < 200;
}

function needsBrowser(html: string): { needs: boolean; reason: string | null } {
  const spa = detectSpa(html);
  if (spa) return { needs: true, reason: `spa:${spa}` };
  if (isThinContent(html)) return { needs: true, reason: "thin_content" };
  return { needs: false, reason: null };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

function markdownHeaders(markdown: string): Record<string, string> {
  return {
    "Content-Type": "text/markdown; charset=utf-8",
    Vary: "Accept",
    "x-markdown-tokens": String(estimateTokens(markdown)),
    "Content-Signal": "ai-train=yes, search=yes, ai-input=yes",
  };
}

function jsonResponse(data: unknown, status = 200): globalThis.Response {
  return new globalThis.Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wantsMarkdown(request: Request): boolean {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("text/markdown");
}

// ── Proxy to local app ────────────────────────────────────────────────────

async function proxyToLocalApp(
  env: Env,
  targetUrl: string,
  fmt: "json" | "markdown",
  selector?: string,
  stealth?: string
): Promise<globalThis.Response | null> {
  if (!env.LOCAL_APP_URL) return null;

  const body: Record<string, string> = {
    url: targetUrl,
    route: "local",
    format: fmt,
  };
  if (selector) body.selector = selector;
  if (stealth) body.stealth = stealth;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.LOCAL_APP_KEY) {
    headers["Authorization"] = `Bearer ${env.LOCAL_APP_KEY}`;
  }

  const resp = await fetch(`${env.LOCAL_APP_URL}/api/scrape`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await resp.json() as Record<string, unknown>;
  // Tag the response so caller knows it went through local app
  data.routed_via = "local_app";
  return jsonResponse(data, resp.status);
}

// ── Route: / ────────────────────────────────────────────────────────────────

function handleRoot(): globalThis.Response {
  return jsonResponse({
    name: "scrapling-js-worker",
    description: "Scrapling HTTP port for Cloudflare Workers — scrape + markdown conversion",
    routes: {
      "/scrape?url=<url>&selector=<css>": "CSS selector extraction (supports Accept: text/markdown)",
      "/markdown?url=<url>": "HTML→Markdown conversion (node-html-markdown)",
      "/markdown?url=<url>&engine=ai": "HTML→Markdown conversion (Workers AI)",
      "POST /markdown": "Convert HTML body → Markdown (accepts raw HTML)",
      "/health": "Health check",
    },
    selectors: {
      css: "div.class, #id, [attr=val]",
      text: "h1::text — extract text content",
      attr: "a::attr(href) — extract attribute values",
    },
    smart_routing: "Detects SPA/thin content → proxies to local app if LOCAL_APP_URL is configured",
  });
}

// ── Proxy UI requests to Local App ──────────────────────────────────────────

async function proxyUiToLocalApp(request: Request, env: Env): Promise<globalThis.Response> {
  const url = new URL(request.url);
  const targetUrl = `${env.LOCAL_APP_URL}${url.pathname}${url.search}`;
  console.log(`[UI Proxy] ${request.method} ${url.pathname} → ${targetUrl}`);
  const headers = new Headers(request.headers);
  headers.set("X-Forwarded-Host", url.hostname);
  headers.set("X-Forwarded-Proto", "https");
  const resp = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    redirect: "manual",
  });
  console.log(`[UI Proxy] ← ${resp.status} ${resp.statusText}`);
  return new globalThis.Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  });
}

// ── Route: /health ──────────────────────────────────────────────────────────

function handleHealth(): globalThis.Response {
  return jsonResponse({ status: "ok", timestamp: new Date().toISOString() });
}

// ── Route: /scrape ──────────────────────────────────────────────────────────

async function handleScrape(request: Request, url: URL, env: Env): Promise<globalThis.Response> {
  const target = url.searchParams.get("url");
  if (!target) return jsonResponse({ error: "Missing ?url= parameter" }, 400);

  const selector = url.searchParams.get("selector") || "title::text";

  const stealth = url.searchParams.get("stealth") || "auto";
  if (!["auto", "header", "tls", "browser"].includes(stealth)) {
    return jsonResponse({ error: "stealth must be auto|header|tls|browser" }, 400);
  }

  // stealth=tls or stealth=browser → must route to local app
  if (stealth === "tls" || stealth === "browser") {
    const localResp = await proxyToLocalApp(env, target, wantsMarkdown(request) ? "markdown" : "json", selector, stealth);
    if (localResp) return localResp;
    return jsonResponse({
      error: "stealth=" + stealth + " requires LOCAL_APP_URL to be configured",
      needs_local_app: true,
    }, 503);
  }

  const page = await Fetcher.get(target, { stealthyHeaders: true, timeout: 15000 });

  // Check if page needs browser rendering
  const browserCheck = needsBrowser(page.body);
  if (browserCheck.needs) {
    // Try proxying to local app
    const localResp = await proxyToLocalApp(env, target, wantsMarkdown(request) ? "markdown" : "json", selector, stealth);
    if (localResp) return localResp;

    // No local app configured — return signal
    return jsonResponse({
      url: target,
      needs_browser: true,
      browser_reason: browserCheck.reason,
      stealth,
      message: "Page requires browser rendering. Set LOCAL_APP_URL to enable automatic proxy.",
    }, 200);
  }

  // Content negotiation: Accept: text/markdown → return page as markdown
  if (wantsMarkdown(request)) {
    const markdown = nhm.translate(page.body);
    return new globalThis.Response(markdown, { headers: markdownHeaders(markdown) });
  }

  const results = page.css(selector);
  const data = Array.isArray(results)
    ? results.map((r) => r.toString())
    : [results.toString()];

  return jsonResponse({ url: target, selector, stealth, status: page.status, results: data });
}

// ── Route: GET /markdown ────────────────────────────────────────────────────

async function handleMarkdownGet(url: URL, env: Env): Promise<globalThis.Response> {
  const target = url.searchParams.get("url");
  if (!target) return jsonResponse({ error: "Missing ?url= parameter" }, 400);

  const engine = url.searchParams.get("engine") || "node-html-markdown";

  const stealth = url.searchParams.get("stealth") || "auto";
  if (!["auto", "header", "tls", "browser"].includes(stealth)) {
    return jsonResponse({ error: "stealth must be auto|header|tls|browser" }, 400);
  }

  // stealth=tls or stealth=browser → route to local app
  if (stealth === "tls" || stealth === "browser") {
    const localResp = await proxyToLocalApp(env, target, "markdown", undefined, stealth);
    if (localResp) return localResp;
    return jsonResponse({
      error: "stealth=" + stealth + " requires LOCAL_APP_URL to be configured",
      needs_local_app: true,
    }, 503);
  }

  const page = await Fetcher.get(target, { stealthyHeaders: true, timeout: 15000 });

  // Check if page needs browser rendering
  const browserCheck = needsBrowser(page.body);
  if (browserCheck.needs) {
    // Try proxying to local app for browser rendering
    const localResp = await proxyToLocalApp(env, target, "markdown", undefined, stealth);
    if (localResp) return localResp;

    // No local app — return signal
    return jsonResponse({
      url: target,
      needs_browser: true,
      browser_reason: browserCheck.reason,
      message: "Page requires browser rendering. Set LOCAL_APP_URL to enable automatic proxy.",
    }, 200);
  }

  let markdown: string;

  if (engine === "ai" && env.AI) {
    const blob = new Blob([page.body], { type: "text/html" });
    const results = await env.AI.toMarkdown([{ name: "page.html", blob }]);
    markdown = results[0]?.data || "";
  } else {
    markdown = nhm.translate(page.body);
  }

  return new globalThis.Response(markdown, { headers: markdownHeaders(markdown) });
}

// ── Route: POST /markdown ───────────────────────────────────────────────────

async function handleMarkdownPost(request: Request, env: Env): Promise<globalThis.Response> {
  const contentType = request.headers.get("Content-Type") || "";
  let html: string;

  if (contentType.includes("application/json")) {
    const body = await request.json() as { html?: string; engine?: string };
    if (!body.html) return jsonResponse({ error: "Missing 'html' field in JSON body" }, 400);
    html = body.html;
    const engine = body.engine || "node-html-markdown";

    if (engine === "ai" && env.AI) {
      const blob = new Blob([html], { type: "text/html" });
      const results = await env.AI.toMarkdown([{ name: "page.html", blob }]);
      const markdown = results[0]?.data || "";
      return new globalThis.Response(markdown, { headers: markdownHeaders(markdown) });
    }
  } else {
    // Raw HTML body
    html = await request.text();
    if (!html.trim()) return jsonResponse({ error: "Empty HTML body" }, 400);
  }

  const markdown = nhm.translate(html);
  return new globalThis.Response(markdown, { headers: markdownHeaders(markdown) });
}

// ── Route: POST /api/scrape ─────────────────────────────────────────────────

async function handleApiScrape(request: Request, env: Env, authInstance: AuthInstance): Promise<globalThis.Response> {
  const result = await requireAuth(request, env, authInstance);
  if (!isAuthUser(result)) return result;

  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const body = await request.json() as Record<string, string>;
  const target = body.url;
  if (!target) return jsonResponse({ error: "url is required" }, 400);

  const format = body.format || "json";
  const stealth = body.stealth || "auto";
  const selector = body.selector;
  const browser = body.browser || "auto";

  if (!["json", "markdown"].includes(format))
    return jsonResponse({ error: "format must be 'json' or 'markdown'" }, 400);
  if (!["auto", "header", "tls", "browser"].includes(stealth))
    return jsonResponse({ error: "stealth must be 'auto', 'header', 'tls', or 'browser'" }, 400);

  const start = Date.now();

  // browser=always or stealth=tls|browser → route to local app
  if (browser === "always" || stealth === "tls" || stealth === "browser") {
    if (!env.LOCAL_APP_URL) {
      return jsonResponse({
        error: `This request requires LOCAL_APP_URL (browser=${browser}, stealth=${stealth})`,
        needs_local_app: true,
      }, 503);
    }
    const localResp = await proxyToLocalApp(env, target, format as "json" | "markdown", selector, stealth);
    if (localResp) {
      const data = await localResp.json() as Record<string, unknown>;
      return jsonResponse({
        ...data,
        stealth,
        route: "local",
        reason: stealth !== "auto" ? `stealth_${stealth}` : "browser_always",
        elapsed_ms: Date.now() - start,
      });
    }
    return jsonResponse({ error: "Failed to proxy to local app" }, 503);
  }

  // stealth=header → worker handles directly with header spoofing
  // stealth=auto → worker fetches, checks for SPA, handles or proxies
  const page = await Fetcher.get(target, { stealthyHeaders: true, timeout: 15000 });
  const html = page.body;

  // SPA/thin content detection (only for auto stealth)
  if (stealth === "auto" && browser !== "never") {
    const browserCheck = needsBrowser(html);
    if (browserCheck.needs) {
      if (env.LOCAL_APP_URL) {
        const localResp = await proxyToLocalApp(env, target, format as "json" | "markdown", selector, "browser");
        if (localResp) {
          const data = await localResp.json() as Record<string, unknown>;
          return jsonResponse({
            ...data,
            stealth: "auto",
            route: "worker+local",
            reason: "auto_spa",
            spa_detected: true,
            spa_framework: browserCheck.reason?.replace("spa:", "") || null,
            elapsed_ms: Date.now() - start,
          });
        }
      }
      return jsonResponse({
        url: target,
        needs_browser: true,
        browser_reason: browserCheck.reason,
        stealth: "auto",
        route: "worker",
        message: "Page requires browser rendering. Set LOCAL_APP_URL to enable proxy.",
      });
    }
  }

  // Static page — worker handles directly
  if (format === "markdown") {
    let markdown: string;
    if (env.AI) {
      try {
        const blob = new Blob([html], { type: "text/html" });
        const results = await env.AI.toMarkdown([{ name: "page.html", blob }]);
        markdown = results[0]?.data || nhm.translate(html);
      } catch (aiErr) {
        console.error("[Markdown] Workers AI failed, falling back to nhm:", aiErr);
        markdown = nhm.translate(html);
      }
    } else {
      markdown = nhm.translate(html);
    }
    return jsonResponse({
      url: target,
      markdown,
      stealth: stealth === "auto" ? "header" : stealth,
      route: "worker",
      reason: stealth === "header" ? "stealth_header" : "auto_static",
      elapsed_ms: Date.now() - start,
    });
  }

  // JSON extraction
  const { Selector } = await import("../src/index");
  const doc = new Selector(html);
  return jsonResponse({
    url: target,
    status: page.status,
    title: String(doc.css("title").first()?.text || ""),
    meta_description: String(doc.css('meta[name="description"]').first()?.getAttribute("content") || ""),
    h1: doc.css("h1").map((el: any) => String(el.text || "")).slice(0, 50),
    h2: doc.css("h2").map((el: any) => String(el.text || "")).slice(0, 50),
    h3: doc.css("h3").map((el: any) => String(el.text || "")).slice(0, 50),
    body_text: String(doc.css("body").first()?.allText || "").slice(0, 5000),
    links: doc.css("a[href]").map((el: any) => String(el.getAttribute("href") || "")).filter(Boolean).slice(0, 200),
    images: doc.css("img[src]").map((el: any) => ({ src: String(el.getAttribute("src") || ""), alt: String(el.getAttribute("alt") || "") })).slice(0, 100),
    links_count: doc.css("a[href]").length,
    images_count: doc.css("img[src]").length,
    stealth: stealth === "auto" ? "header" : stealth,
    route: "worker",
    reason: stealth === "header" ? "stealth_header" : "auto_static",
    browser_used: false,
    spa_detected: false,
    elapsed_ms: Date.now() - start,
  });
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

async function requireAuth(request: Request, env: Env, authInstance: AuthInstance): Promise<AuthUser | globalThis.Response> {
  const user = await authenticateRequest(request, env, authInstance);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  return user;
}

function isAuthUser(result: AuthUser | globalThis.Response): result is AuthUser {
  return "id" in result && "email" in result;
}

// ── Route: /api/auth/status ─────────────────────────────────────────────────

function handleApiAuthStatus(env: Env): globalThis.Response {
  return jsonResponse({ configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) });
}

// ── Route: /api/keys ─────────────────────────────────────────────────────────

async function handleKeys(request: Request, path: string, env: Env, authInstance: AuthInstance): Promise<globalThis.Response> {
  const result = await requireAuth(request, env, authInstance);
  if (!isAuthUser(result)) return result;
  const user = result;

  // GET /api/keys — list keys
  if (request.method === "GET" && path === "/api/keys") {
    const { results } = await env.DB.prepare(
      "SELECT id, name, prefix, created_at, last_used, active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC"
    )
      .bind(user.id)
      .all();
    return jsonResponse({ keys: results || [] });
  }

  // POST /api/keys — create key
  if (request.method === "POST" && path === "/api/keys") {
    const body = (await request.json()) as { name?: string };
    const keyName = body.name || "Unnamed key";

    // Generate raw key: ck_ + 48 hex chars (24 random bytes)
    const randomBytes = new Uint8Array(24);
    crypto.getRandomValues(randomBytes);
    const hex = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const rawKey = `ck_${hex}`;
    const prefix = rawKey.slice(0, 10);

    // Hash for storage
    const keyHash = await sha256HexWorker(rawKey);
    const id = crypto.randomUUID();

    await env.DB.prepare(
      "INSERT INTO api_keys (id, user_id, name, prefix, key_hash, active, created_at) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))"
    )
      .bind(id, user.id, keyName, prefix, keyHash)
      .run();

    return jsonResponse({
      key: { id, name: keyName, prefix, active: 1, created_at: new Date().toISOString() },
      raw_key: rawKey,
    }, 201);
  }

  // PATCH /api/keys/:id — rename key (NOT /toggle)
  if (request.method === "PATCH" && path.match(/^\/api\/keys\/[^/]+$/) && !path.endsWith("/toggle")) {
    const keyId = path.split("/")[3];
    const body = (await request.json()) as { name?: string };
    const newName = body.name?.trim();
    if (!newName) return jsonResponse({ error: "name is required" }, 400);

    const existing = await env.DB.prepare(
      "SELECT id FROM api_keys WHERE id = ? AND user_id = ?"
    ).bind(keyId, user.id).first<{ id: string }>();
    if (!existing) return jsonResponse({ error: "Key not found" }, 404);

    await env.DB.prepare("UPDATE api_keys SET name = ? WHERE id = ?")
      .bind(newName, keyId)
      .run();
    return jsonResponse({ id: keyId, name: newName });
  }

  // PATCH /api/keys/:id/toggle — toggle active flag
  if (request.method === "PATCH" && path.match(/^\/api\/keys\/[^/]+\/toggle$/)) {
    const keyId = path.split("/")[3];
    const existing = await env.DB.prepare(
      "SELECT id, active FROM api_keys WHERE id = ? AND user_id = ?"
    )
      .bind(keyId, user.id)
      .first<{ id: string; active: number }>();
    if (!existing) return jsonResponse({ error: "Key not found" }, 404);

    const newActive = existing.active ? 0 : 1;
    await env.DB.prepare("UPDATE api_keys SET active = ? WHERE id = ?")
      .bind(newActive, keyId)
      .run();
    return jsonResponse({ id: keyId, active: newActive });
  }

  // DELETE /api/keys/:id — delete key
  if (request.method === "DELETE" && path.match(/^\/api\/keys\/[^/]+$/)) {
    const keyId = path.split("/")[3];
    const deleted = await env.DB.prepare(
      "DELETE FROM api_keys WHERE id = ? AND user_id = ?"
    )
      .bind(keyId, user.id)
      .run();
    if (!deleted.meta.changes) return jsonResponse({ error: "Key not found" }, 404);
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

// SHA-256 hex hash (worker-local copy to avoid circular dep)
async function sha256HexWorker(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Route: /api/jobs ─────────────────────────────────────────────────────────

async function handleJobs(request: Request, path: string, env: Env, authInstance: AuthInstance): Promise<globalThis.Response> {
  const result = await requireAuth(request, env, authInstance);
  if (!isAuthUser(result)) return result;
  const user = result;
  const admin = isAdmin(user);
  const isInternal = user.id === "_internal";

  // GET /api/jobs — list jobs
  if (request.method === "GET" && path === "/api/jobs") {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const showAll = url.searchParams.get("all") === "true";
    const filterUserId = url.searchParams.get("user_id");

    // Internal key: return all (local app does its own filtering)
    // Admin with ?all=true: return all
    // Otherwise: filter by user_id
    let query: string;
    let binds: unknown[];
    if (isInternal || (admin && showAll)) {
      if (filterUserId) {
        query = "SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?";
        binds = [filterUserId, limit];
      } else {
        query = "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?";
        binds = [limit];
      }
    } else {
      query = "SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?";
      binds = [user.id, limit];
    }

    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return jsonResponse({ jobs: results || [] });
  }

  // POST /api/jobs — two paths:
  //   1. Internal callers (db.py): D1-only record creation (no proxy to avoid circular loop)
  //   2. External callers (UI/API key): proxy to local app (which creates D1 record + launches crawl)
  if (request.method === "POST" && path === "/api/jobs") {
    if (!isInternal && env.LOCAL_APP_URL) {
      // Proxy to local app so the crawl actually starts
      // Inject real user ID so the job is owned by the actual user, not _internal
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (env.LOCAL_APP_KEY) {
        headers["Authorization"] = `Bearer ${env.LOCAL_APP_KEY}`;
      }
      const body = await request.json() as Record<string, unknown>;
      body.user_id = user.id;
      const resp = await fetch(`${env.LOCAL_APP_URL}/api/jobs`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await resp.json() as Record<string, unknown>;
      return jsonResponse(data, resp.status);
    }

    // D1-only path: internal callers (db.create_job) or no LOCAL_APP_URL
    const body = (await request.json()) as {
      id?: string;
      type?: string;
      params?: Record<string, unknown>;
      user_id?: string;
    };
    const id = body.id || crypto.randomUUID();
    const type = body.type || "scrape";
    const params = JSON.stringify(body.params || {});
    const jobUserId = (isInternal && body.user_id) ? body.user_id : user.id;

    await env.DB.prepare(
      "INSERT INTO jobs (id, type, status, params, user_id, created_at) VALUES (?, ?, 'pending', ?, ?, datetime('now'))"
    )
      .bind(id, type, params, jobUserId)
      .run();

    return jsonResponse({ job_id: id, status: "pending" }, 201);
  }

  // GET /api/jobs/:id — get single job
  if (request.method === "GET" && path.match(/^\/api\/jobs\/[^/]+$/)) {
    const jobId = path.split("/")[3];
    const job = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?")
      .bind(jobId)
      .first<Record<string, unknown>>();
    if (!job) return jsonResponse({ error: "Job not found" }, 404);
    // Ownership check: owner, admin, or internal
    if (!isInternal && !admin && job.user_id !== user.id) {
      return jsonResponse({ error: "Job not found" }, 404);
    }
    return jsonResponse({ job });
  }

  // PATCH /api/jobs/:id — update job
  if (request.method === "PATCH" && path.match(/^\/api\/jobs\/[^/]+$/)) {
    const jobId = path.split("/")[3];

    // Ownership check
    const existing = await env.DB.prepare("SELECT user_id FROM jobs WHERE id = ?")
      .bind(jobId)
      .first<{ user_id: string | null }>();
    if (!existing) return jsonResponse({ error: "Job not found" }, 404);
    if (!isInternal && !admin && existing.user_id !== user.id) {
      return jsonResponse({ error: "Job not found" }, 404);
    }

    const body = (await request.json()) as Record<string, unknown>;

    // Only update allowed fields
    const allowed = ["status", "started_at", "finished_at", "result_file", "error", "stats"];
    // Internal callers can also update user_id (for job reassignment)
    if (isInternal) allowed.push("user_id");
    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const field of allowed) {
      if (field in body) {
        setClauses.push(`${field} = ?`);
        values.push(body[field]);
      }
    }
    if (setClauses.length === 0) return jsonResponse({ error: "No valid fields to update" }, 400);

    values.push(jobId);
    await env.DB.prepare(`UPDATE jobs SET ${setClauses.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();

    const updated = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?")
      .bind(jobId)
      .first();
    return jsonResponse({ job: updated });
  }

  // DELETE /api/jobs/:id — delete job
  if (request.method === "DELETE" && path.match(/^\/api\/jobs\/[^/]+$/)) {
    const jobId = path.split("/")[3];

    // Ownership check
    const existing = await env.DB.prepare("SELECT user_id FROM jobs WHERE id = ?")
      .bind(jobId)
      .first<{ user_id: string | null }>();
    if (!existing) return jsonResponse({ error: "Job not found" }, 404);
    if (!isInternal && !admin && existing.user_id !== user.id) {
      return jsonResponse({ error: "Job not found" }, 404);
    }

    await env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(jobId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

// ── Route: /api/sites ────────────────────────────────────────────────────────

async function handleSites(request: Request, path: string, env: Env, authInstance: AuthInstance): Promise<globalThis.Response> {
  const result = await requireAuth(request, env, authInstance);
  if (!isAuthUser(result)) return result;
  const user = result;
  const admin = isAdmin(user);
  const isInternal = user.id === "_internal";

  // GET /api/sites — list sites
  if (request.method === "GET" && path === "/api/sites") {
    const url = new URL(request.url);
    const showAll = url.searchParams.get("all") === "true";
    const filterUserId = url.searchParams.get("user_id");

    let query: string;
    let binds: unknown[];
    if (isInternal || (admin && showAll)) {
      if (filterUserId) {
        query = "SELECT * FROM sites WHERE user_id = ? ORDER BY key ASC";
        binds = [filterUserId];
      } else {
        query = "SELECT * FROM sites ORDER BY key ASC";
        binds = [];
      }
    } else {
      query = "SELECT * FROM sites WHERE user_id = ? ORDER BY key ASC";
      binds = [user.id];
    }

    const { results } = binds.length
      ? await env.DB.prepare(query).bind(...binds).all()
      : await env.DB.prepare(query).all();

    // Convert rows to { key: config } format for backwards compatibility
    const sites: Record<string, Record<string, unknown>> = {};
    for (const row of results || []) {
      const r = row as Record<string, unknown>;
      sites[r.key as string] = {
        label: r.label,
        sitemap: r.sitemap,
        allowed_domains: JSON.parse((r.allowed_domains as string) || "[]"),
        browser: !!(r.browser as number),
        download_assets: !!(r.download_assets as number),
        user_id: r.user_id,
        id: r.id,
      };
    }
    return jsonResponse({ sites });
  }

  // POST /api/sites — create/upsert site
  if (request.method === "POST" && path === "/api/sites") {
    const body = (await request.json()) as {
      key?: string;
      label?: string;
      sitemap?: string;
      allowed_domains?: string[];
      browser?: boolean;
      download_assets?: boolean;
      user_id?: string;
    };

    const key = (body.key || "").trim().toLowerCase();
    if (!key) return jsonResponse({ error: "Missing required field: key" }, 400);

    const siteUserId = (isInternal && body.user_id) ? body.user_id : user.id;
    const label = (body.label || key).trim();
    const sitemap = (body.sitemap || "").trim();
    const allowedDomains = JSON.stringify(body.allowed_domains || []);
    const browser = body.browser ? 1 : 0;
    const downloadAssets = body.download_assets ? 1 : 0;

    // Upsert: check if exists for this user
    const existing = await env.DB.prepare(
      "SELECT id FROM sites WHERE user_id = ? AND key = ?"
    ).bind(siteUserId, key).first<{ id: string }>();

    if (existing) {
      await env.DB.prepare(
        "UPDATE sites SET label = ?, sitemap = ?, allowed_domains = ?, browser = ?, download_assets = ? WHERE id = ?"
      ).bind(label, sitemap, allowedDomains, browser, downloadAssets, existing.id).run();
      return jsonResponse({ ok: true, key, id: existing.id });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO sites (id, user_id, key, label, sitemap, allowed_domains, browser, download_assets, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    ).bind(id, siteUserId, key, label, sitemap, allowedDomains, browser, downloadAssets).run();

    return jsonResponse({ ok: true, key, id }, 201);
  }

  // DELETE /api/sites/:key — delete site
  if (request.method === "DELETE" && path.match(/^\/api\/sites\/[^/]+$/)) {
    const siteKey = decodeURIComponent(path.split("/")[3]);

    // Find the site
    let site: Record<string, unknown> | null;
    if (isInternal || admin) {
      site = await env.DB.prepare("SELECT id, user_id FROM sites WHERE key = ?")
        .bind(siteKey)
        .first();
    } else {
      site = await env.DB.prepare("SELECT id, user_id FROM sites WHERE key = ? AND user_id = ?")
        .bind(siteKey, user.id)
        .first();
    }

    if (!site) return jsonResponse({ error: "Site not found" }, 404);

    await env.DB.prepare("DELETE FROM sites WHERE id = ?")
      .bind(site.id as string)
      .run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

// ── Route: /api/users/:id ────────────────────────────────────────────────────

async function handleUsers(request: Request, path: string, env: Env, authInstance: AuthInstance): Promise<globalThis.Response> {
  // Require internal key auth
  const result = await requireAuth(request, env, authInstance);
  if (!isAuthUser(result)) return result;
  if (result.id !== "_internal") return jsonResponse({ error: "Forbidden — internal only" }, 403);

  if (request.method === "GET" && path.match(/^\/api\/users\/[^/]+$/)) {
    const userId = path.split("/")[3];
    const user = await env.DB.prepare("SELECT id, email, name, picture, created_at FROM users WHERE id = ?")
      .bind(userId)
      .first();
    if (!user) return jsonResponse({ error: "User not found" }, 404);
    return jsonResponse({ user });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

// ── Main router ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<globalThis.Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ── react-auth init + migration ──────────────────────────────────────
      const { auth: authInstance, migrate: runMigrations } = createAuth(env);
      await runMigrations();

      // react-auth handles /api/auth/* routes (login, callback, session, logout, register, role)
      const authResponse = await authInstance.handleRequest(request);
      if (authResponse) return authResponse;

      // ── API auth compat routes ──────────────────────────────────────────
      if (path === "/api/auth/status") return handleApiAuthStatus(env);
      if (path === "/api/auth/me") {
        const user = await authenticateRequest(request, env, authInstance);
        if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
        return jsonResponse({ user });
      }

      // ── Local-app-only endpoints: proxy before D1 handlers ────────────────
      // SSE log stream, job cancel, output files, routes config, benchmark
      if (env.LOCAL_APP_URL) {
        if (/^\/api\/jobs\/[^/]+\/(log|cancel)$/.test(path)) return await proxyUiToLocalApp(request, env);
        if (path.startsWith("/api/output")) return await proxyUiToLocalApp(request, env);
        if (path.startsWith("/api/routes")) return await proxyUiToLocalApp(request, env);
        if (path === "/api/benchmark") return await proxyUiToLocalApp(request, env);
      }

      // ── API data routes (D1 direct) ──────────────────────────────────────
      if (path === "/api/scrape" || path === "/api/scrape/") return await handleApiScrape(request, env, authInstance);
      if (path.startsWith("/api/keys")) return await handleKeys(request, path, env, authInstance);
      if (path.startsWith("/api/jobs")) return await handleJobs(request, path, env, authInstance);
      if (path.startsWith("/api/sites")) return await handleSites(request, path, env, authInstance);
      if (path.startsWith("/api/users/")) return await handleUsers(request, path, env, authInstance);

      // ── Catch-all: proxy unhandled /api/* to local app ───────────────────
      if (path.startsWith("/api/") && env.LOCAL_APP_URL) {
        console.log(`[Router] proxy unhandled /api/* to local app: ${path}`);
        return await proxyUiToLocalApp(request, env);
      }

      // Unknown /api/* routes without LOCAL_APP_URL → 404
      if (path.startsWith("/api/")) {
        return jsonResponse({ error: "Not found", path }, 404);
      }

      // ── Public scrape/markdown routes (no auth) ──────────────────────────
      if (path === "/health") return handleHealth();
      if (path === "/scrape") return await handleScrape(request, url, env);
      if (path === "/markdown") {
        if (request.method === "POST") return await handleMarkdownPost(request, env);
        return await handleMarkdownGet(url, env);
      }

      // Legacy: /?url= → /scrape
      if (path === "/" && url.searchParams.has("url")) return await handleScrape(request, url, env);

      // ── Static assets handle everything else (React SPA) ─────────────────
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return handleRoot();
    } catch (e) {
      return jsonResponse({ error: (e as Error).message }, 500);
    }
  },
};
