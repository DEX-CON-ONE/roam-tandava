/**
 * Formatting helpers for the owner screens. Times are always shown in the
 * studio's timezone, never the browser's.
 */

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function weekdayLabel(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/** "12.50" / "12,50" / "£12" → 1250. Null for blank or invalid input. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d.,]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export function formatMoney(cents: number | null | undefined, currency = "GBP"): string {
  if (cents == null) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function withZone(options: Intl.DateTimeFormatOptions, timeZone: string | undefined, iso: string): string {
  const date = new Date(iso);
  try {
    return date.toLocaleString(undefined, { ...options, timeZone });
  } catch {
    return date.toLocaleString(undefined, options);
  }
}

export function formatDay(iso: string, timeZone?: string): string {
  return withZone({ weekday: "short", day: "numeric", month: "short" }, timeZone, iso);
}

export function formatTime(iso: string, timeZone?: string): string {
  return withZone({ hour: "2-digit", minute: "2-digit", hour12: false }, timeZone, iso);
}

export function formatDayTime(iso: string, timeZone?: string): string {
  return `${formatDay(iso, timeZone)}, ${formatTime(iso, timeZone)}`;
}

export function formatDate(iso: string, timeZone?: string): string {
  return withZone({ day: "numeric", month: "short", year: "numeric" }, timeZone, iso);
}

/** The calendar date (YYYY-MM-DD) and clock time (HH:MM) of an instant in a timezone. */
export function zonedParts(iso: string, timeZone?: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

export function personName(
  person: { first_name?: string | null; last_name?: string | null; display_name?: string | null; email?: string | null } | null | undefined,
  fallback = "Unnamed",
): string {
  if (!person) return fallback;
  const name = person.display_name?.trim() || [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
  return name || person.email || fallback;
}

export function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

const TRANSACTION_LABELS: Record<string, string> = {
  membership_purchase: "Membership",
  membership_renewal: "Membership renewal",
  class_pack_purchase: "Class pack",
  drop_in: "Drop-in",
  workshop: "Event",
  retreat: "Event",
  late_cancel_fee: "Late cancellation fee",
  refund: "Refund",
  credit_purchase: "Credit",
};

export function transactionLabel(type: string): string {
  return TRANSACTION_LABELS[type] ?? type.replace(/_/g, " ");
}

export type StripeMode = "not_connected" | "test" | "live";

/** What the build's Stripe publishable key says about card payments. */
export function stripeModeFromKey(key: string | undefined): StripeMode {
  if (!key || key.includes("your-key")) return "not_connected";
  if (key.startsWith("pk_test_")) return "test";
  if (key.startsWith("pk_live_")) return "live";
  return "not_connected";
}
