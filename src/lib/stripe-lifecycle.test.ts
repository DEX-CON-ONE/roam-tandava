import { describe, expect, it } from "vitest";
import {
  assertStripeKeyMode,
  stripeStatusToMembershipStatus,
} from "../../supabase/functions/stripe/config.ts";

describe("Stripe lifecycle configuration", () => {
  it("rejects live keys unless explicitly enabled and accepts test keys", () => {
    expect(() => assertStripeKeyMode("sk_live_fixture", false)).toThrow("live-mode");
    expect(assertStripeKeyMode("sk_live_fixture", true)).toBe("sk_live_fixture");
    expect(assertStripeKeyMode("sk_test_fixture", false)).toBe("sk_test_fixture");
    expect(() => assertStripeKeyMode(undefined, false)).toThrow("not configured");
  });

  it.each([
    ["active", "active"],
    ["trialing", "active"],
    ["past_due", "past_due"],
    ["unpaid", "past_due"],
    ["incomplete", "past_due"],
    ["incomplete_expired", "expired"],
    ["canceled", "cancelled"],
    ["paused", "paused"],
    ["unknown", "past_due"],
  ])("maps Stripe status %s to membership status %s", (stripeStatus, membershipStatus) => {
    expect(stripeStatusToMembershipStatus(stripeStatus)).toBe(membershipStatus);
  });
});
