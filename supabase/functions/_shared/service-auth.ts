/**
 * Service-role-only guard for server-to-server Edge Functions (email / sms / push).
 *
 * These functions send to arbitrary recipients, so they must never be callable
 * with the public anon key or an end user's session: the Supabase gateway's
 * `verify_jwt` accepts both. Only a request whose bearer token is exactly the
 * project's service role key is let through. Fails closed when the key is not
 * configured.
 */

type Handler = (req: Request) => Response | Promise<Response>;

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

export function isServiceRoleRequest(req: Request, serviceRoleKey: string | undefined): boolean {
  const token = bearerToken(req);
  return Boolean(serviceRoleKey && token && timingSafeEqual(token, serviceRoleKey));
}

/**
 * Wrap a handler so only service-role callers reach it.
 *   - OPTIONS (CORS preflight) passes through untouched
 *   - no bearer token            -> 401
 *   - any other token (anon key, signed-in user, wrong key) -> 403
 */
export function withServiceRoleOnly(
  handler: Handler,
  getServiceRoleKey: () => string | undefined,
  corsHeaders: Record<string, string> = defaultCorsHeaders,
): Handler {
  const deny = (error: string, status: number) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  return (req) => {
    if (req.method === "OPTIONS") return handler(req);
    if (!bearerToken(req)) return deny("Not authenticated", 401);
    if (!isServiceRoleRequest(req, getServiceRoleKey())) {
      return deny("This function is server-to-server only (service role required)", 403);
    }
    return handler(req);
  };
}
