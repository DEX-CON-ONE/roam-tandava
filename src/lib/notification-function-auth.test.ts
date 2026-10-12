import { describe, expect, it, vi } from "vitest";
import { isServiceRoleRequest, jwtRole, withServiceRoleOnly } from "../../supabase/functions/_shared/service-auth.ts";

// Fixtures only: shaped like Supabase keys, never real ones. Signatures are not
// checked here because the gateway (verify_jwt) does that before the function runs.
function fixtureJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.fixture-signature`;
}
const anonJwt = fixtureJwt({ role: "anon", ref: "fixture" });
const memberSessionJwt = fixtureJwt({ role: "authenticated", sub: "member-fixture" });
const staffSessionJwt = fixtureJwt({ role: "authenticated", sub: "owner-fixture", app_metadata: { role: "service_role" } });
const serviceRoleJwt = fixtureJwt({ role: "service_role", ref: "fixture" });
const publishableKey = "sb_publishable_fixture";
const secretKey = "sb_secret_fixture";
const credentials = {
  serviceRoleKey: secretKey,
  secretKeys: JSON.stringify({ default: secretKey, ops: "sb_secret_second_fixture" }),
};

function request(headers: Record<string, string> = {}, method = "POST") {
  return new Request("https://test.invalid/functions/v1/email", {
    method,
    headers,
    ...(method === "POST" ? { body: JSON.stringify({ to: "someone@example.test", subject: "s", html: "<p>h</p>" }) } : {}),
  });
}
const bearer = (token: string, apikey = publishableKey) => ({ Authorization: `Bearer ${token}`, apikey });

function guarded(getCredentials: () => { serviceRoleKey?: string; secretKeys?: string } = () => credentials) {
  const send = vi.fn(async () => Response.json({ success: true, provider: "console" }));
  return { send, handler: withServiceRoleOnly(send, getCredentials) };
}

describe("email / sms / push service-role guard", () => {
  it("refuses a request with no credentials (401) without sending", async () => {
    const { handler, send } = guarded();
    expect((await handler(request())).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["legacy anon JWT", bearer(anonJwt, anonJwt)],
    ["publishable key as bearer", bearer(publishableKey)],
    ["publishable key in apikey only", { apikey: publishableKey }],
  ])("refuses the public key: %s (403) without sending", async (_label, headers) => {
    const { handler, send } = guarded();
    const response = await handler(request(headers));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("service role") });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([["member", memberSessionJwt], ["studio owner/staff", staffSessionJwt]])(
    "refuses a signed-in %s session (403): no browser caller is allowed",
    async (_label, token) => {
      const { handler, send } = guarded();
      expect((await handler(request(bearer(token)))).status).toBe(403);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("refuses near-miss and malformed credentials", async () => {
    const { handler, send } = guarded();
    const notJson = `x.${Buffer.from("not json").toString("base64url")}.y`;
    for (const token of [secretKey.slice(0, -1), `${secretKey}x`, secretKey.toUpperCase(), "service_role", "a.b", "..", notJson]) {
      expect((await handler(request(bearer(token)))).status).toBe(403);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["legacy service-role JWT", bearer(serviceRoleJwt)],
    ["secret key as bearer", bearer(secretKey)],
    ["secret key in apikey header", { apikey: secretKey }],
    ["second named secret key", bearer("sb_secret_second_fixture")],
  ])("lets the service role through to the handler: %s (200 path)", async (_label, headers) => {
    const { handler, send } = guarded();
    const response = await handler(request(headers));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fails closed for key callers when no service key is configured", async () => {
    for (const empty of [{}, { serviceRoleKey: "", secretKeys: "" }]) {
      const { handler, send } = guarded(() => empty);
      expect((await handler(request(bearer(secretKey)))).status).toBe(403);
      expect((await handler(request(bearer(anonJwt)))).status).toBe(403);
      expect((await handler(request())).status).toBe(401);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("passes CORS preflight through untouched", async () => {
    const { handler, send } = guarded();
    await handler(request({}, "OPTIONS"));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reads only the top-level role claim", () => {
    expect(jwtRole(serviceRoleJwt)).toBe("service_role");
    expect(jwtRole(staffSessionJwt)).toBe("authenticated");
    expect(jwtRole(secretKey)).toBeNull();
    expect(isServiceRoleRequest(request(bearer(anonJwt)), credentials)).toBe(false);
  });
});
