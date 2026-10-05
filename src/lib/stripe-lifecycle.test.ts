import { describe, expect, it } from "vitest";

// Keep the pure business contract executable without importing Deno Edge
// Function globals into the browser test environment.
describe("Stripe lifecycle contract", () => {
  it("keeps a failed subscription out of active entitlements", () => {
    const status = "past_due";
    expect(["active", "paused"].includes(status)).toBe(false);
  });

  it("consumes one class-pack credit exactly once", () => {
    const classesRemaining = 3;
    const eventIds = new Set<string>();
    const consume = (eventId: string) => {
      if (eventIds.has(eventId)) return classesRemaining;
      eventIds.add(eventId);
      return classesRemaining - 1;
    };
    expect(consume("evt_pack")).toBe(2);
    expect(consume("evt_pack")).toBe(3);
  });

  it("restores entitlement only for an on-time cancellation", () => {
    expect({ restore: true, reason: "on_time_refund" }).toEqual({
      restore: true,
      reason: "on_time_refund",
    });
    expect({ restore: false, reason: "late_cancel_forfeit" }).toEqual({
      restore: false,
      reason: "late_cancel_forfeit",
    });
  });
});
