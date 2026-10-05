export function assertStripeKeyMode(
  key: string | undefined,
  name: string,
  allowLive = Deno.env.get("ALLOW_LIVE_STRIPE") === "true",
): string {
  if (!key) throw new Error(`${name} is not configured`);
  const isLive = key.startsWith("sk_live_") || key.startsWith("pk_live_");
  if (isLive && !allowLive) {
    throw new Error(`${name} is live-mode but ALLOW_LIVE_STRIPE is not enabled`);
  }
  return key;
}

export function stripeStatusToMembershipStatus(status: string): string {
  return {
    active: "active",
    trialing: "active",
    past_due: "past_due",
    unpaid: "past_due",
    incomplete: "past_due",
    incomplete_expired: "expired",
    canceled: "cancelled",
    paused: "paused",
  }[status] ?? "past_due";
}

export function entitlementAfterCancellation(
  _source: "membership" | "class_pack",
  late: boolean,
): { restore: boolean; reason: "on_time_refund" | "late_cancel_forfeit" } {
  return late
    ? { restore: false, reason: "late_cancel_forfeit" }
    : { restore: true, reason: "on_time_refund" };
}
