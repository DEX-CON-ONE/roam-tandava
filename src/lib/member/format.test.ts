import { describe, expect, it } from "vitest";
import {
  availabilityLabel, bookingStatusLabel, cancellationState, checkoutReturnUrls, dayKey, formatDateTime, formatDay, formatMoney,
  formatTime, friendlyError, groupByDay, registerUrl, safeNextPath, signInUrl, spacesLeft,
} from "./format";

describe("member booking formatting", () => {
  it("formats money in the studio's currency", () => {
    expect(formatMoney(1200, "GBP")).toContain("12.00");
    expect(formatMoney(1200, "gbp")).toMatch(/£|GBP/);
    expect(formatMoney(null, "GBP")).toBe("");
    expect(formatMoney(500, "NOT-A-CURRENCY")).toBe("5.00 NOT-A-CURRENCY");
  });

  it("shows class times in the studio's timezone, not the viewer's", () => {
    // 18:30 UTC on 3 Nov 2026 is 18:30 in London (GMT) and 13:30 in New York (EST).
    const iso = "2026-11-03T18:30:00Z";
    expect(formatTime(iso, "Europe/London")).toBe("18:30");
    expect(formatTime(iso, "America/New_York")).toBe("13:30");
    expect(formatDay(iso, "Europe/London")).toBe("Tuesday 3 November");
    expect(formatDateTime(iso, "Europe/London")).toMatch(/Tue,? 3 Nov,? 18:30/);
    // Summer time: 17:30 UTC is 18:30 in London.
    expect(formatTime("2026-07-01T17:30:00Z", "Europe/London")).toBe("18:30");
    expect(formatTime(iso, "Not/AZone")).toBe("18:30");
  });

  it("groups sessions by studio-local day, in time order", () => {
    const rows = [
      { id: "late", starts_at: "2026-11-03T23:30:00Z" }, // still 3 Nov in London, already 4 Nov in Tokyo
      { id: "next", starts_at: "2026-11-04T09:00:00Z" },
      { id: "early", starts_at: "2026-11-03T07:00:00Z" },
    ];
    const london = groupByDay(rows, "Europe/London");
    expect(london.map((group) => [group.key, group.rows.map((row) => row.id)])).toEqual([
      ["2026-11-03", ["early", "late"]],
      ["2026-11-04", ["next"]],
    ]);
    expect(london[0].label).toBe("Tuesday 3 November");
    expect(dayKey(rows[0].starts_at, "Asia/Tokyo")).toBe("2026-11-04");
  });

  it("reports spaces left and never goes negative", () => {
    expect(spacesLeft({ capacity: 12, booked_count: 5 })).toBe(7);
    expect(spacesLeft({ capacity: 12, booked_count: 14 })).toBe(0);
    expect(availabilityLabel({ capacity: 12, booked_count: 5 })).toBe("7 spaces left");
    expect(availabilityLabel({ capacity: 12, booked_count: 11 })).toBe("1 space left");
    expect(availabilityLabel({ capacity: 12, booked_count: 12 })).toBe("Full");
  });
});

describe("friendlyError", () => {
  it.each([
    ["Already booked for this class", "You are already booked into this class."],
    ["You are already booked for this class", "You are already booked into this class."],
    ["Class is full", "This class is now full."],
    ["No classes remaining on this pack", "There are no classes left on this pass."],
    ["No classes remaining in this cycle", "You have used all the classes in your membership for this period."],
    ["Class pack has expired", "This pass has expired."],
    ["Class pack does not cover this class", "This pass does not cover this class."],
    ["Drop-in price not configured", "This class cannot be paid for online yet."],
    ["Booking is already cancelled", "This booking is already cancelled."],
    ["Not authenticated", "Please sign in again to continue."],
    ["TypeError: Failed to fetch", "We could not reach the booking system. Check your connection and try again."],
  ])("%s", (backend, shown) => {
    expect(friendlyError(backend)).toBe(shown);
  });

  it("passes unknown errors through instead of hiding them", () => {
    expect(friendlyError("Something specific went wrong")).toBe("Something specific went wrong");
    expect(friendlyError("")).toBe("Something went wrong. Please try again.");
    expect(friendlyError(null)).toBe("Something went wrong. Please try again.");
  });
});

describe("checkout return and sign-in links", () => {
  it("builds return URLs on this app for the studio", () => {
    const urls = checkoutReturnUrls("https://book.example.test/", "harbour-loft", "drop_in", { occurrenceId: "occ-1", started: 1700000000000 });
    expect(urls.successUrl).toBe("https://book.example.test/s/harbour-loft/checkout/success?kind=drop_in&t=1700000000000&occ=occ-1");
    expect(urls.cancelUrl).toBe("https://book.example.test/s/harbour-loft/checkout/cancelled?kind=drop_in&t=1700000000000&occ=occ-1");
    expect(checkoutReturnUrls("https://book.example.test", "a", "class_pack", { started: 1 }).successUrl).toBe("https://book.example.test/s/a/checkout/success?kind=class_pack&t=1");
  });

  it("only accepts same-app paths as a post-sign-in destination", () => {
    expect(safeNextPath("/s/harbour-loft/class/abc")).toBe("/s/harbour-loft/class/abc");
    expect(safeNextPath("/s/a/checkout/success?kind=drop_in&t=1")).toBe("/s/a/checkout/success?kind=drop_in&t=1");
    for (const bad of ["https://evil.example.test", "//evil.example.test", "/\\evil", "javascript:alert(1)", "s/a", "", null, "/auth/login", "/a b"]) {
      expect(safeNextPath(bad), String(bad)).toBeNull();
    }
    expect(signInUrl("/s/a/class/b?x=1")).toBe("/auth/login?next=%2Fs%2Fa%2Fclass%2Fb%3Fx%3D1");
    expect(registerUrl("/s/a/plans")).toBe("/auth/register?next=%2Fs%2Fa%2Fplans");
  });
});

describe("cancellation state and status labels", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  const booking = (patch: Record<string, unknown> = {}) => ({
    status: "confirmed", starts_at: "2026-11-05T18:30:00Z", free_cancel_until: "2026-11-04T18:30:00Z", ...patch,
  }) as { status: string; starts_at: string; free_cancel_until: string | null };

  it("is free before the studio's cut-off and late after it", () => {
    expect(cancellationState(booking(), now)).toBe("free");
    expect(cancellationState(booking({ free_cancel_until: "2026-11-03T11:00:00Z" }), now)).toBe("late");
    expect(cancellationState(booking({ free_cancel_until: null }), now)).toBe("free");
    expect(cancellationState(booking({ status: "waitlisted", free_cancel_until: "2026-11-03T11:00:00Z" }), now)).toBe("free");
  });

  it("cannot cancel a class that has started or a booking that is not active", () => {
    expect(cancellationState(booking({ starts_at: "2026-11-03T11:59:00Z" }), now)).toBe("not_cancellable");
    for (const status of ["cancelled", "late_cancel", "checked_in", "no_show"]) {
      expect(cancellationState(booking({ status }), now)).toBe("not_cancellable");
    }
  });

  it("labels statuses for members", () => {
    expect(bookingStatusLabel("confirmed")).toBe("Booked");
    expect(bookingStatusLabel("waitlisted")).toBe("On the waitlist");
    expect(bookingStatusLabel("late_cancel")).toBe("Cancelled late");
  });
});
