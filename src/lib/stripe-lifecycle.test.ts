import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assertStripeKeyMode, stripeStatusToMembershipStatus } from "../../supabase/functions/stripe/config.ts";
import type { StripeDatabase, StripeEvent, StripeWebhookClient } from "../../supabase/functions/stripe-webhook/handler.ts";

const webhookSecret = "whsec_test_fixture_only";

function signedRequest(event: Record<string, unknown>, secret = webhookSecret) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("https://test.invalid", {
    method: "POST", body, headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
  });
}

function databaseMock() {
  const eventRows = new Map<string, { status: "processing" | "processed" }>();
  const calls: Array<{ table: string; operation: string; values?: unknown }> = [];
  const database = {
    from(table: string) {
      return {
        insert(values: unknown) {
          calls.push({ table, operation: "insert", values });
          return { select: () => ({ maybeSingle: async () => {
            const id = (values as { id?: string }).id;
            if (table === "stripe_webhook_events" && id && eventRows.has(id)) return { data: null, error: { code: "23505" } };
            if (table === "stripe_webhook_events" && id) eventRows.set(id, { status: "processing" });
            return { data: { id }, error: null };
          }, single: async () => ({ data: { id: "fixture-id" }, error: null }) }) };
        },
        update(values: unknown) {
          calls.push({ table, operation: "update", values });
          return { eq: (_column: string, value: unknown) => {
            // Mirrors `update ... where id = ? [and status = 'processing'] returning id`.
            const complete = (onlyIfProcessing: boolean) => {
              const row = table === "stripe_webhook_events" ? eventRows.get(String(value)) : undefined;
              if (!row || (onlyIfProcessing && row.status !== "processing")) return [] as Array<{ id: string }>;
              eventRows.set(String(value), { status: "processed" });
              return [{ id: String(value) }];
            };
            const done = Promise.resolve({ error: null });
            return Object.assign(done, {
              eq: (_secondColumn: string, _secondValue: unknown) =>
                Object.assign(Promise.resolve({ error: null }), { select: async () => ({ data: complete(true), error: null }) }),
            });
          } };
        },
        select() { return { eq: (_column: string, value: unknown) => ({ single: async () => ({ data: eventRows.get(String(value)) ? { id: String(value), ...eventRows.get(String(value)) } : null, error: null }) }) }; },
      };
    },
    rpc: vi.fn(async () => ({ error: null })),
  };
  return { database, calls };
}

async function loadHandler() {
  const { createStripeWebhookHandler } = await import("../../supabase/functions/stripe-webhook/handler.ts");
  return createStripeWebhookHandler;
}

describe("Stripe lifecycle configuration", () => {
  it("rejects live keys unless explicitly enabled and accepts test keys", () => {
    expect(() => assertStripeKeyMode("sk_live_fixture", false)).toThrow("live-mode");
    expect(assertStripeKeyMode("sk_live_fixture", true)).toBe("sk_live_fixture");
    expect(assertStripeKeyMode("sk_test_fixture", false)).toBe("sk_test_fixture");
    expect(() => assertStripeKeyMode(undefined, false)).toThrow("not configured");
  });

  it.each([
    ["active", "active"], ["trialing", "active"], ["past_due", "past_due"],
    ["unpaid", "past_due"], ["incomplete", "past_due"], ["incomplete_expired", "expired"],
    ["canceled", "cancelled"], ["paused", "paused"], ["unknown", "past_due"],
  ])("maps Stripe status %s to membership status %s", (stripeStatus, membershipStatus) => {
    expect(stripeStatusToMembershipStatus(stripeStatus)).toBe(membershipStatus);
  });
});

describe("Stripe webhook production handler", () => {
  it("rejects a bad signature without touching the database", async () => {
    const createHandler = await loadHandler();
    const { database, calls } = databaseMock();
    const handler = createHandler({ supabase: database, webhookSecret,
      stripe: { webhooks: { constructEventAsync: () => { throw new Error("bad signature"); } } } satisfies StripeWebhookClient,
      onEvent: vi.fn(), });
    const response = await handler(new Request("https://test.invalid", {
      method: "POST", body: "{}", headers: { "stripe-signature": "invalid" },
    }));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("claims a signed event once and ignores its replay", async () => {
    const createHandler = await loadHandler();
    const { database, calls } = databaseMock();
    const handler = createHandler({ supabase: database, webhookSecret,
      stripe: { webhooks: { constructEventAsync: (body) => JSON.parse(body) as StripeEvent } } satisfies StripeWebhookClient,
      onEvent: async (_event, db) => { await (db as StripeDatabase & { from: (table: string) => { update: (v: unknown) => { eq: (c: string, value: unknown) => Promise<unknown> } } }).from("memberships").update({ status: "active" }).eq("stripe_subscription_id", "sub_fixture"); }, });
    const event = { id: "evt_replay_fixture", type: "customer.subscription.updated", data: {
      object: { id: "sub_fixture", status: "active", current_period_start: 0, current_period_end: 1 },
    } };
    expect((await handler(signedRequest(event))).status).toBe(200);
    expect(await (await handler(signedRequest(event))).json()).toMatchObject({ duplicate: true });
    expect(calls.filter((call) => call.table === "stripe_webhook_events" && call.operation === "insert")).toHaveLength(2);
    expect(calls.filter((call) => call.table === "memberships" && call.operation === "update")).toHaveLength(1);
  });

  it("retries a claimed event after the first processing attempt fails", async () => {
    const createHandler = await loadHandler();
    const { database } = databaseMock();
    let attempts = 0;
    const handler = createHandler({ supabase: database, webhookSecret,
      stripe: { webhooks: { constructEventAsync: (body) => JSON.parse(body) as StripeEvent } } satisfies StripeWebhookClient,
      onEvent: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient fixture failure");
      },
    });
    const event = { id: "evt_retry_fixture", type: "invoice.payment_failed", data: { object: {} } };
    expect((await handler(signedRequest(event))).status).toBe(500);
    expect((await handler(signedRequest(event))).status).toBe(200);
    expect(attempts).toBe(2);
  });

  it("marks failed payments past_due and consumes a class pack once per event", async () => {
    const createHandler = await loadHandler();
    const { database, calls } = databaseMock();
    const handler = createHandler({ supabase: database, webhookSecret,
      stripe: { webhooks: { constructEventAsync: (body) => JSON.parse(body) as StripeEvent } } satisfies StripeWebhookClient,
      onEvent: async (event, db) => {
        if (event.type === "invoice.payment_failed") await (db as StripeDatabase & { from: (table: string) => { update: (v: unknown) => { eq: (c: string, value: unknown) => Promise<unknown> } } }).from("memberships").update({ status: "past_due" }).eq("stripe_subscription_id", "sub_fixture");
        if (event.type === "checkout.session.completed") await (db as StripeDatabase & { from: (table: string) => { insert: (v: unknown) => { select: (c: string) => { single: () => Promise<unknown> } } } }).from("class_packs").insert({ stripe_payment_intent_id: "pi_fixture" }).select("id").single();
      }, });
    await handler(signedRequest({ id: "evt_failed_fixture", type: "invoice.payment_failed", data: { object: { subscription: "sub_fixture" } } }));
    expect(calls.some((call) => call.table === "memberships" && call.operation === "update" && JSON.stringify(call.values).includes("past_due"))).toBe(true);
    const classPack = { id: "evt_pack_fixture", type: "checkout.session.completed", data: { object: {
      metadata: { type: "class_pack", studio_id: "studio", profile_id: "profile", class_pack_type_id: "pack-type" },
      payment_intent: "pi_fixture", amount_total: 1000,
    } } };
    await handler(signedRequest(classPack));
    await handler(signedRequest(classPack));
    expect(calls.filter((call) => call.table === "class_packs" && call.operation === "insert")).toHaveLength(1);
  });
});

describe("Stripe webhook post-processing hook (confirmation emails)", () => {
  const parse = { webhooks: { constructEventAsync: (body: string) => JSON.parse(body) as StripeEvent } } satisfies StripeWebhookClient;
  const event = { id: "evt_notify_fixture", type: "checkout.session.completed", data: { object: { metadata: { type: "drop_in" } } } };

  it("runs once for an event and not again on a replay", async () => {
    const createHandler = await loadHandler();
    const { database } = databaseMock();
    const onProcessed = vi.fn(async () => {});
    const handler = createHandler({ supabase: database, webhookSecret, stripe: parse, onEvent: vi.fn(async () => {}), onProcessed });
    expect((await handler(signedRequest(event))).status).toBe(200);
    expect(await (await handler(signedRequest(event))).json()).toMatchObject({ duplicate: true });
    expect((await handler(signedRequest(event))).status).toBe(200);
    expect(onProcessed).toHaveBeenCalledTimes(1);
    expect(onProcessed).toHaveBeenCalledWith(expect.objectContaining({ id: "evt_notify_fixture" }), expect.anything());
  });

  it("runs once when two deliveries of the same event are processed concurrently", async () => {
    const createHandler = await loadHandler();
    const { database } = databaseMock();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const onEvent = vi.fn(async () => { await gate; });
    const onProcessed = vi.fn(async () => {});
    const handler = createHandler({ supabase: database, webhookSecret, stripe: parse, onEvent, onProcessed });
    const first = handler(signedRequest(event));
    const second = handler(signedRequest(event));
    await new Promise((resolve) => setTimeout(resolve, 5));
    release();
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(onEvent).toHaveBeenCalledTimes(2); // the ledger does not serialise concurrent duplicates...
    expect(onProcessed).toHaveBeenCalledTimes(1); // ...but only one delivery wins processing -> processed
  });

  it("does not run when processing fails, then runs once after the successful retry", async () => {
    const createHandler = await loadHandler();
    const { database } = databaseMock();
    let attempts = 0;
    const onProcessed = vi.fn(async () => {});
    const handler = createHandler({ supabase: database, webhookSecret, stripe: parse, onProcessed,
      onEvent: async () => { attempts += 1; if (attempts === 1) throw new Error("transient fixture failure"); } });
    expect((await handler(signedRequest(event))).status).toBe(500);
    expect(onProcessed).not.toHaveBeenCalled();
    expect((await handler(signedRequest(event))).status).toBe(200);
    expect(onProcessed).toHaveBeenCalledTimes(1);
  });

  it("still acknowledges the event when the hook throws, and does not retry it", async () => {
    const createHandler = await loadHandler();
    const { database } = databaseMock();
    const onProcessed = vi.fn(async () => { throw new Error("email provider down"); });
    const handler = createHandler({ supabase: database, webhookSecret, stripe: parse, onEvent: vi.fn(async () => {}), onProcessed });
    const response = await handler(signedRequest(event));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(await (await handler(signedRequest(event))).json()).toMatchObject({ duplicate: true });
    expect(onProcessed).toHaveBeenCalledTimes(1);
  });

  it("does not run for a rejected signature", async () => {
    const createHandler = await loadHandler();
    const { database } = databaseMock();
    const onProcessed = vi.fn(async () => {});
    const handler = createHandler({ supabase: database, webhookSecret, onEvent: vi.fn(), onProcessed,
      stripe: { webhooks: { constructEventAsync: () => { throw new Error("bad signature"); } } } satisfies StripeWebhookClient });
    expect((await handler(signedRequest(event))).status).toBe(400);
    expect(onProcessed).not.toHaveBeenCalled();
  });
});
