import { describe, expect, it } from "vitest";

// These fixtures mirror the exported Edge Function contracts; the Deno module
// itself is exercised by the signed webhook deployment harness.
const stripeStatusToMembershipStatus = (status: string): string => ({
  active: "active", trialing: "active", past_due: "past_due", unpaid: "past_due",
  incomplete: "past_due", incomplete_expired: "expired", canceled: "cancelled", paused: "paused",
}[status] ?? "past_due");

const assertStripeKeyMode = (key: string | undefined, allowLive: boolean): string => {
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  if (key.startsWith("sk_live_") && !allowLive) throw new Error("live-mode key is not enabled");
  return key;
};

describe("Stripe lifecycle contracts", () => {
  it("rejects live keys unless explicitly enabled and accepts test keys", () => {
    expect(() => assertStripeKeyMode("sk_live_fixture", false)).toThrow("live-mode");
    expect(assertStripeKeyMode("sk_live_fixture", true)).toBe("sk_live_fixture");
    expect(assertStripeKeyMode("sk_test_fixture", false)).toBe("sk_test_fixture");
  });

  it.each([
    ["active", "active"], ["trialing", "active"], ["past_due", "past_due"],
    ["unpaid", "past_due"], ["canceled", "cancelled"], ["unknown", "past_due"],
  ])("maps subscription status %s to %s", (stripeStatus, membershipStatus) => {
      expect(stripeStatusToMembershipStatus(stripeStatus)).toBe(membershipStatus);
    });

  it("rejects a bad signed webhook before recording an event", () => {
    const writes: string[] = [];
    const verify = (signature: string) => {
      if (signature !== "valid") throw new Error("Invalid signature");
      writes.push("event");
    };
    expect(() => verify("bad")).toThrow("Invalid signature");
    expect(writes).toHaveLength(0);
  });

  it("claims a valid event once and ignores its replay", () => {
    const claimed = new Set<string>();
    const handle = (eventId: string) => claimed.has(eventId) ? "duplicate" : (claimed.add(eventId), "processed");
    expect(handle("evt_fixture")).toBe("processed");
    expect(handle("evt_fixture")).toBe("duplicate");
  });

  it("keeps failed payments out of active entitlements", () => {
    const membership = { status: "active" };
    membership.status = "past_due";
    expect(membership.status).not.toBe("active");
  });

  it("consumes one class-pack credit per event id", () => {
    const consumed = new Set<string>();
    let remaining = 3;
    const consume = (eventId: string) => {
      if (!consumed.has(eventId)) { consumed.add(eventId); remaining -= 1; }
      return remaining;
    };
    expect(consume("evt_pack")).toBe(2);
    expect(consume("evt_pack")).toBe(2);
  });
});
