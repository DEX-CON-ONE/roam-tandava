import { describe, expect, it } from "vitest";
import { centsToInput, parseMoneyToCents, personName, slugify, stripeModeFromKey, transactionLabel, zonedParts } from "./format";

describe("owner formatting", () => {
  it("parses money typed by an owner", () => {
    expect(parseMoneyToCents("12.50")).toBe(1250);
    expect(parseMoneyToCents("£15")).toBe(1500);
    expect(parseMoneyToCents("9,99")).toBe(999);
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(centsToInput(1500)).toBe("15");
    expect(centsToInput(1250)).toBe("12.50");
    expect(centsToInput(null)).toBe("");
  });

  it("reads a session's date and time in the studio's timezone", () => {
    // 17:30 UTC in July is 18:30 in London (BST) and 13:30 in New York.
    expect(zonedParts("2026-07-01T17:30:00Z", "Europe/London")).toEqual({ date: "2026-07-01", time: "18:30" });
    expect(zonedParts("2026-07-01T17:30:00Z", "America/New_York")).toEqual({ date: "2026-07-01", time: "13:30" });
    expect(zonedParts("2026-12-31T23:30:00Z", "Europe/London")).toEqual({ date: "2026-12-31", time: "23:30" });
    expect(zonedParts("2026-07-01T23:30:00Z", "Europe/London")).toEqual({ date: "2026-07-02", time: "00:30" });
  });

  it("names people and falls back to their email", () => {
    expect(personName({ first_name: "Sam", last_name: "Lee" })).toBe("Sam Lee");
    expect(personName({ first_name: "", last_name: "", email: "a@b.test" })).toBe("a@b.test");
    expect(personName(null, "No coach")).toBe("No coach");
  });

  it("labels transactions and slugs", () => {
    expect(transactionLabel("class_pack_purchase")).toBe("Class pack");
    expect(transactionLabel("something_new")).toBe("something new");
    expect(slugify("  Strength & Conditioning! ")).toBe("strength-conditioning");
  });

  it("reports Stripe as not connected unless a real publishable key is set", () => {
    expect(stripeModeFromKey(undefined)).toBe("not_connected");
    expect(stripeModeFromKey("pk_test_your-key-here")).toBe("not_connected");
    expect(stripeModeFromKey("pk_test_abc123")).toBe("test");
    expect(stripeModeFromKey("pk_live_abc123")).toBe("live");
  });
});
