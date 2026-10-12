/**
 * Service-role-only guard for server-to-server Edge Functions (email / sms / push).
 *
 * These functions send to arbitrary recipients, so they must never be callable
 * with the public anon / publishable key or an end user's session: the Supabase
 * gateway's `verify_jwt` accepts both. A request is let through only when it
 * carries a service credential, in either form Supabase issues:
 *
 *   1. a secret API key: the `Authorization` bearer or `apikey` header exactly
 *      equals SUPABASE_SERVICE_ROLE_KEY or one of SUPABASE_SECRET_KEYS; or
 *   2. a legacy service-role JWT: a bearer JWT whose `role` claim is
 *      `service_role`. Its signature is verified by the gateway, so these
 *      functions MUST stay deployed with `verify_jwt = true` (pinned in
 *      supabase/config.toml). Never deploy them with --no-verify-jwt.
 *
 * Fails closed when nothing matches.
 */

type Handler = (req: Request) => Response | Promise<Response>;

export interface ServiceCredentials {
  /** SUPABASE_SERVICE_ROLE_KEY */
  serviceRoleKey?: string;
  /** SUPABASE_SECRET_KEYS (JSON of named secret keys, or a single key) */
  secretKeys?: string;
}

const defaultCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function configuredKeys(credentials: ServiceCredentials): string[] {
  const keys: string[] = [];
  if (credentials.serviceRoleKey) keys.push(credentials.serviceRoleKey);
  const collect = (value: unknown) => {
    if (typeof value === "string" && value) keys.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  if (credentials.secretKeys) {
    try {
      collect(JSON.parse(credentials.secretKeys));
    } catch {
      collect(credentials.secretKeys);
    }
  }
  return keys;
}

/**
 * True when the bearer token is exactly `secret`. For functions called by a
 * machine that holds a dedicated shared secret instead of a Supabase key.
 * Fails closed when the secret is not configured.
 */
export function hasBearerSecret(req: Request, secret: string | undefined): boolean {
  const token = bearerToken(req);
  return Boolean(secret && token && timingSafeEqual(token, secret));
}

/** Role claim of a JWT, without verifying it (the gateway verifies the signature). */
export function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function isServiceRoleRequest(req: Request, credentials: ServiceCredentials): boolean {
  const token = bearerToken(req);
  const apiKey = req.headers.get("apikey")?.trim() || null;
  const keys = configuredKeys(credentials);
  for (const presented of [token, apiKey]) {
    if (presented && keys.some((key) => timingSafeEqual(presented, key))) return true;
  }
  return Boolean(token && jwtRole(token) === "service_role");
}

/**
 * Wrap a handler so only service-role callers reach it.
 *   - OPTIONS (CORS preflight) passes through untouched
 *   - no bearer token and no apikey header -> 401
 *   - anything that is not a service credential (anon / publishable key,
 *     signed-in user, wrong key) -> 403
 */
export function withServiceRoleOnly(
  handler: Handler,
  getCredentials: () => ServiceCredentials,
  corsHeaders: Record<string, string> = defaultCorsHeaders,
): Handler {
  const deny = (error: string, status: number) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  return (req) => {
    if (req.method === "OPTIONS") return handler(req);
    if (!bearerToken(req) && !req.headers.get("apikey")) return deny("Not authenticated", 401);
    if (!isServiceRoleRequest(req, getCredentials())) {
      return deny("This function is server-to-server only (service role required)", 403);
    }
    return handler(req);
  };
}
