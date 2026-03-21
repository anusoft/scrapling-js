// scrapling-js/examples/auth.ts
import { createReactAuth, createGoogleProvider, migrate } from "@1moby/just-auth";
import type { DatabaseAdapter, PreparedStatement, BoundStatement } from "@1moby/just-auth";

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  AI?: {
    toMarkdown(
      docs: Array<{ name: string; blob: Blob }>
    ): Promise<Array<{ name: string; data: string; tokens: number }>>;
  };
  LOCAL_APP_URL?: string;
  LOCAL_APP_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BASE_URL?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  role?: string;
}

const SUPER_ADMINS = ["anu@1moby.com", "waranon@1moby.com"];

export function isAdmin(user: AuthUser | null): boolean {
  return !!user && (user.role === "admin" || SUPER_ADMINS.includes(user.email));
}

// D1 adapter for react-auth
export function createD1Adapter(db: D1Database): DatabaseAdapter {
  return {
    prepare(sql: string): PreparedStatement {
      return {
        bind(...params: unknown[]): BoundStatement {
          const stmt = db.prepare(sql).bind(...params);
          return {
            async run() { await stmt.run(); return { success: true }; },
            async first<T = Record<string, unknown>>(): Promise<T | null> {
              return await stmt.first<T>();
            },
            async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
              const result = await stmt.all<T>();
              return { results: result.results };
            },
          };
        },
      };
    },
    async batch(statements: BoundStatement[]): Promise<unknown[]> {
      const results: unknown[] = [];
      for (const stmt of statements) results.push(await stmt.run());
      return results;
    },
  };
}

let _migrated = false;

export function createAuth(env: Env) {
  const db = createD1Adapter(env.DB);
  const baseUrl = env.BASE_URL || "https://scraper.1moby.tech";

  const providers = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      createGoogleProvider({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectURI: `${baseUrl}/api/auth/callback/google`,
      })
    );
  }

  const auth = createReactAuth({
    providers,
    database: db,
    cookie: { secure: true, sameSite: "lax" },
    credentials: false,
    allowDangerousEmailAccountLinking: true,
    rbac: {
      statements: {
        job: ["create", "read", "update", "delete"],
        site: ["create", "read", "update", "delete"],
        user: ["list", "set-role"],
        key: ["create", "read", "delete"],
      },
      roles: {
        user: {
          job: ["create", "read", "update", "delete"],
          site: ["create", "read", "update", "delete"],
          key: ["create", "read", "delete"],
        },
        admin: "*",
      },
      defaultRole: "user",
    },
  });

  return {
    auth,
    db,
    migrate: async () => {
      if (!_migrated) {
        await migrate(db);
        _migrated = true;
      }
    },
  };
}

// --- Internal key + API key auth (kept from old system) ---

async function validateApiKey(db: D1Database, key: string): Promise<AuthUser | null> {
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  const hashHex = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
  const row = await db.prepare(
    "SELECT ak.user_id, u.email, u.name, u.avatar_url, u.role FROM api_keys ak JOIN users u ON u.id = ak.user_id WHERE ak.key_hash = ? AND ak.active = 1"
  ).bind(hashHex).first<{ user_id: string; email: string; name: string; avatar_url: string; role: string }>();
  if (!row) return null;
  await db.prepare("UPDATE api_keys SET last_used = datetime('now') WHERE key_hash = ?").bind(hashHex).run();
  return { id: row.user_id, email: row.email, name: row.name || "", picture: row.avatar_url || "", role: row.role };
}

/**
 * Authenticate a request. Checks in order:
 * 1. Internal key (sk_internal_) — server-to-server, no DB
 * 2. Session cookie — react-auth session validation
 * 3. API key (ck_) — SHA-256 hash lookup in D1
 * Returns AuthUser or null.
 */
export async function authenticateRequest(
  request: Request,
  env: Env,
  authInstance: ReturnType<typeof createReactAuth>
): Promise<AuthUser | null> {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  // 1. Internal key
  if (token && env.LOCAL_APP_KEY && token === env.LOCAL_APP_KEY) {
    return { id: "_internal", email: "worker@internal", name: "CF Worker", picture: "" };
  }

  // 2. Session cookie (react-auth)
  const session = await authInstance.auth(request);
  if (session) {
    return {
      id: session.user.id,
      email: session.user.email || "",
      name: session.user.name || "",
      picture: session.user.avatarUrl || "",
      role: session.user.role,
    };
  }

  // 3. API key
  if (token && token.startsWith("ck_")) {
    return validateApiKey(env.DB, token);
  }

  return null;
}
