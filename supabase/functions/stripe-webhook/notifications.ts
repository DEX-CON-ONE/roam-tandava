/**
 * Checkout notifications (server-side only).
 *
 * Called by the stripe-webhook handler once per Stripe event, AFTER the event
 * has been processed and this delivery has won the ledger's
 * processing -> processed transition (see handler.ts), so a webhook replay or
 * a concurrent duplicate delivery never sends twice.
 *
 * For a completed Checkout Session it sends:
 *   - the customer a confirmation (booking confirmation for a drop-in, purchase
 *     confirmation for a class pack / membership / workshop), reply-to the studio
 *   - the studio a "new booking / new sale" notification, reply-to the customer
 *
 * Studio name, contact address, timezone and currency come from the `studios`
 * row. Nothing here throws: a failed lookup or send is logged and skipped so
 * email can never fail a payment.
 */

import {
  bookingConfirmationEmail,
  purchaseConfirmationEmail,
  studioSaleNotificationEmail,
  type TemplateResult,
} from "../email/templates.ts";

export type NotificationEmail = TemplateResult & { to: string; replyTo?: string };
export type NotificationSendResult = { success: boolean; messageId?: string; error?: string; provider: string };
export type NotificationSender = (message: NotificationEmail) => Promise<NotificationSendResult>;

type Row = Record<string, unknown>;
type QueryResult<T> = Promise<{ data: T | null; error: unknown }>;
/** The slice of the Supabase client this module uses. */
export type NotificationDatabase = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => { maybeSingle: () => QueryResult<Row> } & PromiseLike<{ data: Row[] | null; error: unknown }>;
    };
    insert: (values: unknown) => PromiseLike<{ error: unknown }>;
  };
};

export type CheckoutSessionLike = {
  id?: string;
  amount_total?: number | null;
  currency?: string | null;
  customer_details?: { email?: string | null; name?: string | null } | null;
  metadata?: Record<string, string> | null;
};

export type CheckoutEventLike = { id: string; type: string; data: { object: unknown } };

type Kind = "drop_in" | "class_pack" | "membership" | "workshop";
const KINDS: Kind[] = ["drop_in", "class_pack", "membership", "workshop"];

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

async function one(db: NotificationDatabase, table: string, columns: string, id: unknown): Promise<Row | null> {
  if (!id) return null;
  const { data, error } = await db.from(table).select(columns).eq("id", id).maybeSingle();
  if (error) console.error(`[stripe-webhook] notification lookup failed: ${table}`);
  return data ?? null;
}

function formatWhen(startsAt: unknown, timeZone: string): string {
  const date = new Date(String(startsAt));
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC";
  }
}

function formatAmount(cents: number | null | undefined, currency: string): string {
  if (typeof cents !== "number") return "";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** A member can switch off email, or this category of email, per studio or globally. */
async function customerOptedOut(db: NotificationDatabase, profileId: string, studioId: string, kind: Kind): Promise<boolean> {
  const { data, error } = await db.from("notification_preferences")
    .select("studio_id, email_enabled, booking_confirmations, payment_alerts")
    .eq("profile_id", profileId);
  if (error || !data) return false;
  const rows = data.filter((row) => row.studio_id === studioId || row.studio_id === null || row.studio_id === undefined);
  // A studio-specific row wins over the global default.
  const row = rows.find((candidate) => candidate.studio_id === studioId) ?? rows[0];
  if (!row) return false;
  if (row.email_enabled === false) return true;
  return kind === "drop_in" ? row.booking_confirmations === false : row.payment_alerts === false;
}

async function describePurchase(db: NotificationDatabase, kind: Kind, metadata: Record<string, string>) {
  if (kind === "class_pack") {
    const pack = await one(db, "class_pack_types", "name, class_count", metadata.class_pack_type_id);
    const count = typeof pack?.class_count === "number" ? ` (${pack.class_count} classes)` : "";
    return { itemName: `${str(pack?.name) || "Class pack"}${count}`, relatedType: "class_pack_type", relatedId: metadata.class_pack_type_id };
  }
  if (kind === "membership") {
    const membership = await one(db, "membership_types", "name", metadata.membership_type_id);
    return { itemName: str(membership?.name) || "Membership", relatedType: "membership_type", relatedId: metadata.membership_type_id };
  }
  const event = await one(db, "events", "title", metadata.event_id);
  return { itemName: str(event?.title) || "Workshop", relatedType: "event", relatedId: metadata.event_id };
}

export async function sendCheckoutNotifications({
  event,
  database,
  sendEmail,
  appUrl,
}: {
  event: CheckoutEventLike;
  database: NotificationDatabase;
  sendEmail: NotificationSender;
  appUrl: string;
}): Promise<{ sent: number; skipped: string[] }> {
  const outcome = { sent: 0, skipped: [] as string[] };
  try {
    if (event.type !== "checkout.session.completed") return outcome;
    const session = (event.data.object ?? {}) as CheckoutSessionLike;
    const metadata = session.metadata ?? {};
    const kind = metadata.type as Kind;
    if (!KINDS.includes(kind) || !metadata.studio_id || !metadata.profile_id) {
      outcome.skipped.push("not a studio checkout");
      return outcome;
    }

    const [studio, profile] = await Promise.all([
      one(database, "studios", "name, email, timezone, currency", metadata.studio_id),
      one(database, "profiles", "first_name, last_name, display_name, email", metadata.profile_id),
    ]);
    if (!studio || !str(studio.name)) {
      outcome.skipped.push("studio not found");
      return outcome;
    }
    const studioName = str(studio.name);
    const studioEmail = str(studio.email);
    const customerEmail = str(profile?.email) || str(session.customer_details?.email);
    const firstName = str(profile?.first_name) || str(profile?.display_name) || "there";
    const customerName = [str(profile?.first_name), str(profile?.last_name)].filter(Boolean).join(" ")
      || str(profile?.display_name) || str(session.customer_details?.name) || "A customer";
    const amount = formatAmount(session.amount_total, str(session.currency) || str(studio.currency) || "USD");
    const base = appUrl.replace(/\/+$/, "");

    let customerMessage: TemplateResult;
    let itemName: string;
    let relatedType: string;
    let relatedId: string | undefined;
    let when = "";

    if (kind === "drop_in") {
      const occurrence = await one(database, "class_occurrences", "starts_at, ends_at, offering_id, location_id, teacher_id", metadata.occurrence_id);
      const [offering, location, teacher] = await Promise.all([
        one(database, "offerings", "name, duration_minutes", occurrence?.offering_id),
        one(database, "locations", "name, address_line1, city", occurrence?.location_id),
        one(database, "profiles", "first_name, last_name, display_name", occurrence?.teacher_id),
      ]);
      itemName = str(offering?.name) || "Class";
      when = occurrence ? formatWhen(occurrence.starts_at, str(studio.timezone) || "UTC") : "";
      const minutes = occurrence
        ? Math.round((new Date(String(occurrence.ends_at)).getTime() - new Date(String(occurrence.starts_at)).getTime()) / 60000)
        : NaN;
      customerMessage = bookingConfirmationEmail({
        firstName,
        className: itemName,
        studioName,
        dateTime: when || "See your schedule for the time",
        duration: Number.isFinite(minutes) && minutes > 0 ? minutes : Number(offering?.duration_minutes) || 60,
        instructor: str(teacher?.display_name) || [str(teacher?.first_name), str(teacher?.last_name)].filter(Boolean).join(" ") || studioName,
        address: [str(location?.name), str(location?.address_line1), str(location?.city)].filter(Boolean).join(", "),
        appUrl: base,
      });
      relatedType = "class_occurrence";
      relatedId = metadata.occurrence_id;
    } else {
      const purchase = await describePurchase(database, kind, metadata);
      itemName = purchase.itemName;
      relatedType = purchase.relatedType;
      relatedId = purchase.relatedId;
      customerMessage = purchaseConfirmationEmail({ firstName, studioName, itemName, amount, appUrl: base });
    }

    const deliver = async (
      audience: "customer" | "studio",
      to: string,
      message: TemplateResult,
      replyTo: string,
      profileId: string | null,
    ) => {
      let result: NotificationSendResult;
      try {
        result = await sendEmail({ to, ...message, replyTo: replyTo || undefined });
      } catch {
        result = { success: false, error: "send threw", provider: "unknown" };
      }
      if (result.success) outcome.sent += 1;
      else {
        outcome.skipped.push(`${audience} send failed`);
        console.error(`[stripe-webhook] ${audience} notification failed for ${event.id} (${result.provider})`);
      }
      try {
        const now = new Date().toISOString();
        const { error } = await database.from("notification_deliveries").insert({
          studio_id: metadata.studio_id,
          profile_id: profileId,
          notification_type: audience === "studio" ? "studio_sale_notification" : kind === "drop_in" ? "booking_confirmation" : "purchase_confirmation",
          channel: "email",
          subject: message.subject,
          body: message.text,
          related_entity_type: relatedType,
          related_entity_id: relatedId ?? null,
          status: result.success ? "sent" : "failed",
          sent_at: result.success ? now : null,
          failed_at: result.success ? null : now,
          error_message: result.success ? null : "send failed",
          provider: result.provider,
          provider_message_id: result.messageId ?? null,
        });
        if (error) console.error("[stripe-webhook] could not record notification delivery");
      } catch {
        console.error("[stripe-webhook] could not record notification delivery");
      }
    };

    if (!customerEmail) outcome.skipped.push("customer has no email");
    else if (await customerOptedOut(database, metadata.profile_id, metadata.studio_id, kind)) outcome.skipped.push("customer opted out");
    else await deliver("customer", customerEmail, customerMessage, studioEmail, metadata.profile_id);

    if (!studioEmail) outcome.skipped.push("studio has no contact email");
    else {
      await deliver("studio", studioEmail, studioSaleNotificationEmail({
        studioName,
        kind: kind === "drop_in" ? "booking" : "sale",
        customerName,
        customerEmail,
        itemName,
        when,
        amount,
        manageUrl: `${base}/manage`,
      }), customerEmail, null);
    }
  } catch {
    // Never let a notification problem surface to Stripe as a failed webhook.
    console.error(`[stripe-webhook] notifications failed for ${event.id}`);
    outcome.skipped.push("unexpected error");
  }
  return outcome;
}
