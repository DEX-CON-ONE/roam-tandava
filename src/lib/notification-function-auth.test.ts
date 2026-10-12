import { describe, expect, it, vi } from "vitest";
import { isServiceRoleRequest, withServiceRoleOnly } from "../../supabase/functions/_shared/service-auth.ts";

// Fixture values only: shaped like Supabase keys, never real ones.
const serviceRoleKey = "service-role-fixture.header.signature";
const anonKey = "anon-fixture.header.signature";
const memberSessionJwt = "member-session-fixture.header.signature";
const staffSessionJwt = "staff-session-fixture.header.signature";

function request(token?: string, method = "POST") {
  return new Request("https://test.invalid/functions/v1/email", {
    method,
    headers: token ? { Authorization: `Bearer ${token}`, apikey: anonKey } : {},
    ...(method === "POST" ? { body: JSON.stringify({ to: "someone@example.test", subject: "s", html: "<p>h</p>" }) } : {}),
  });
}

function guarded(getKey: () => string | undefined = () => serviceRoleKey) {
  const send = vi.fn(async () => Response.json({ success: true, provider: "console" }));
  return { send, handler: withServiceRoleOnly(send, getKey) };
}

describe("email / sms / push service-role guard", () => {
  it("refuses a request with no credentials (401) without sending", async () => {
    const { handler, send } = guarded();
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses the public anon key (403) without sending", async () => {
    const { handler, send } = guarded();
    const response = await handler(request(anonKey));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("service role") });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([["member", memberSessionJwt], ["studio staff", staffSessionJwt]])(
    "refuses a signed-in %s session (403): no browser caller is allowed",
    async (_label, token) => {
      const { handler, send } = guarded();
      expect((await handler(request(token))).status).toBe(403);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("refuses near-miss tokens (prefix, suffix, different case)", async () => {
    const { handler, send } = guarded();
    for (const token of [serviceRoleKey.slice(0, -1), `${serviceRoleKey}x`, serviceRoleKey.toUpperCase()]) {
      expect((await handler(request(token))).status).toBe(403);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("lets the service role through to the handler (200 path)", async () => {
    const { handler, send } = guarded();
    const response = await handler(request(serviceRoleKey));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the service role key is not configured", async () => {
    for (const key of [undefined, ""]) {
      const { handler, send } = guarded(() => key);
      expect((await handler(request(serviceRoleKey))).status).toBe(403);
      expect((await handler(request(""))).status).toBe(401);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("passes CORS preflight through untouched", async () => {
    const { handler, send } = guarded();
    await handler(request(undefined, "OPTIONS"));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("isServiceRoleRequest only matches the exact key", () => {
    expect(isServiceRoleRequest(request(serviceRoleKey), serviceRoleKey)).toBe(true);
    expect(isServiceRoleRequest(request(anonKey), serviceRoleKey)).toBe(false);
    expect(isServiceRoleRequest(request(), serviceRoleKey)).toBe(false);
  });
});
