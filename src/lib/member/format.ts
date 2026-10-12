/**
 * Pure helpers for the member booking screens (formatting, grouping, URLs,
 * error copy). No React, no network: everything here is unit-tested.
 */

export interface ScheduleRow {
  occurrence_id: string;
  starts_at: string;
  ends_at: string;
  room: string | null;
  offering_id: string;
  offering_name: string;
  offering_description: string | null;
  level: string | null;
  duration_minutes: number | null;
  drop_in_price_cents: number | null;
  location_name: string | null;
  location_address: string | null;
  teacher_name: string | null;
  capacity: number;
  booked_count: number;
  waitlist_count: number;
  my_booking_id: string | null;
  my_booking_status: string | null;
}

export function formatMoney(cents: number | null | undefined, currency: string | null | undefined): string {
  if (typeof cents !== "number") return "";
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

function zoned(iso: string, timeZone: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timeZone || "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(date);
  }
}

/** Calendar day in the STUDIO's timezone, e.g. "2026-11-03". Used as a grouping key. */
export function dayKey(iso: string, timeZone: string | null | undefined): string {
  const parts = zoned(iso, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }).split("/");
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : "";
}

/** "Tuesday 3 November" in the studio's timezone. */
export function formatDay(iso: string, timeZone: string | null | undefined): string {
  return zoned(iso, timeZone, { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
}

/** "18:30" in the studio's timezone. */
export function formatTime(iso: string, timeZone: string | null | undefined): string {
  return zoned(iso, timeZone, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "Tue 3 Nov, 18:30" in the studio's timezone. */
export function formatDateTime(iso: string, timeZone: string | null | undefined): string {
  return zoned(iso, timeZone, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function groupByDay<T extends { starts_at: string }>(rows: T[], timeZone: string | null | undefined): Array<{ key: string; label: string; rows: T[] }> {
  const groups = new Map<string, { key: string; label: string; rows: T[] }>();
  for (const row of [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const key = dayKey(row.starts_at, timeZone);
    if (!groups.has(key)) groups.set(key, { key, label: formatDay(row.starts_at, timeZone), rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()];
}

export function spacesLeft(row: Pick<ScheduleRow, "capacity" | "booked_count">): number {
  return Math.max(0, (row.capacity ?? 0) - (row.booked_count ?? 0));
}

export function availabilityLabel(row: Pick<ScheduleRow, "capacity" | "booked_count">): string {
  const left = spacesLeft(row);
  if (left === 0) return "Full";
  return left === 1 ? "1 space left" : `${left} spaces left`;
}

/**
 * Turn a backend error (book_class / cancel_booking exceptions, checkout
 * function errors) into a sentence for the member. Unknown errors pass through
 * unchanged rather than being hidden.
 */
export function friendlyError(message: string | null | undefined): string {
  const text = (message ?? "").trim();
  const rules: Array<[RegExp, string]> = [
    [/already booked/i, "You are already booked into this class."],
    [/class is full/i, "This class is now full."],
    [/class is cancelled/i, "This class has been cancelled."],
    [/class not found/i, "We could not find this class. It may have been removed."],
    [/no classes remaining on this pack/i, "There are no classes left on this pass."],
    [/no classes remaining in this cycle/i, "You have used all the classes in your membership for this period."],
    [/has expired/i, "This pass has expired."],
    [/is not active/i, "This pass is not active."],
    [/outside its billing period/i, "Your membership is between billing periods. Please try again shortly."],
    [/does not cover this (class|location)/i, "This pass does not cover this class."],
    [/drop-in price not configured/i, "This class cannot be paid for online yet."],
    [/already cancelled/i, "This booking is already cancelled."],
    [/not authorized/i, "You cannot change this booking."],
    [/not authenticated|jwt|unauthori[sz]ed/i, "Please sign in again to continue."],
    [/failed to fetch|networkerror|load failed/i, "We could not reach the booking system. Check your connection and try again."],
  ];
  for (const [pattern, friendly] of rules) if (pattern.test(text)) return friendly;
  return text || "Something went wrong. Please try again.";
}

export type CheckoutKind = "drop_in" | "class_pack" | "membership";

/** Where Stripe sends the member back to. `started` lets the page recognise the new purchase. */
export function checkoutReturnUrls(origin: string, slug: string, kind: CheckoutKind, params: { occurrenceId?: string; started: number }) {
  const query = new URLSearchParams({ kind, t: String(params.started) });
  if (params.occurrenceId) query.set("occ", params.occurrenceId);
  const base = `${origin.replace(/\/+$/, "")}/s/${encodeURIComponent(slug)}/checkout`;
  return { successUrl: `${base}/success?${query}`, cancelUrl: `${base}/cancelled?${query}` };
}

/** Only same-app paths are accepted as a post-sign-in destination. */
export function safeNextPath(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\s\\]/.test(raw) || raw.startsWith("/auth/")) return null;
  return raw;
}

export function signInUrl(next: string): string {
  return `/auth/login?next=${encodeURIComponent(next)}`;
}

export function registerUrl(next: string): string {
  return `/auth/register?next=${encodeURIComponent(next)}`;
}

/** Can this booking still be cancelled by the member, and is it free to do so? */
export function cancellationState(
  booking: { status: string; starts_at: string; free_cancel_until: string | null; class_cancelled?: boolean },
  now: Date = new Date(),
): "not_cancellable" | "free" | "late" {
  if (!["confirmed", "waitlisted"].includes(booking.status)) return "not_cancellable";
  if (new Date(booking.starts_at).getTime() <= now.getTime()) return "not_cancellable";
  if (booking.status === "waitlisted") return "free";
  if (!booking.free_cancel_until) return "free";
  return now.getTime() <= new Date(booking.free_cancel_until).getTime() ? "free" : "late";
}

export function bookingStatusLabel(status: string): string {
  switch (status) {
    case "confirmed": return "Booked";
    case "waitlisted": return "On the waitlist";
    case "cancelled": return "Cancelled";
    case "late_cancel": return "Cancelled late";
    case "checked_in": return "Attended";
    case "no_show": return "Missed";
    default: return status;
  }
}
