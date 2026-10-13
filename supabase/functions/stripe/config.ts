export function assertStripeKeyMode(
  key: string | undefined,
  allowLive: boolean,
  name = "STRIPE_SECRET_KEY",
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

export type StripeKeyMode = "missing" | "test" | "live";

/** What kind of secret key this deployment holds. */
export function stripeKeyMode(key: string | undefined): StripeKeyMode {
  if (!key) return "missing";
  return key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "test";
}

/**
 * Whether a connected account can be paid through. Both flags matter: an owner
 * can submit their details and still be unable to take payments while Stripe
 * verifies them.
 */
export function connectStatusFromAccount(account: { charges_enabled?: boolean | null; details_submitted?: boolean | null }): {
  connected: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
} {
  const chargesEnabled = Boolean(account.charges_enabled);
  const detailsSubmitted = Boolean(account.details_submitted);
  return { connected: chargesEnabled && detailsSubmitted, chargesEnabled, detailsSubmitted };
}

/** A Stripe failure as something the owner screen can explain. Never includes a key. */
export function describeStripeError(error: unknown): { problem: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const type = (error as { type?: string } | null)?.type ?? "";
  if (/signed up for Connect/i.test(raw)) {
    return {
      problem: "connect_not_enabled",
      message: "Connect is not switched on for the Stripe account behind this site, so a studio cannot link its own account yet.",
    };
  }
  if (type === "StripeAuthenticationError" || /Invalid API Key|api key/i.test(raw)) {
    return { problem: "stripe_key_rejected", message: "Stripe rejected this site's key." };
  }
  if (/No such account|does not have access to account|account .* does not exist/i.test(raw)) {
    return { problem: "account_unavailable", message: "The linked Stripe account can no longer be reached. Disconnect it and connect again." };
  }
  return { problem: "stripe_error", message: "Stripe could not complete that. Try again in a moment." };
}

/** True when checkout must refuse rather than charge the deployment's own account. */
export function mustRefuseWithoutConnectedAccount(requireConnected: boolean, connectedAccount: string | null): boolean {
  return requireConnected && !connectedAccount;
}
