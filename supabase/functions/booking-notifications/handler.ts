/**
 * Booking confirmation emails for bookings made with a membership or class pack.
 *
 * Those bookings are created by the `book_class` RPC straight from the browser
 * to Postgres, so no Edge Function sees them. A database trigger on `bookings`
 * (migration 00023) calls this function through pg_net after the booking is
 * committed. Drop-in bookings paid through Stripe Checkout are confirmed by
 * the stripe-webhook path instead and are skipped here.
 *
 *   - Once per booking: each email is claimed by inserting a
 *     `notification_deliveries` row guarded by a unique index, so a repeated
 *     call for the same booking id sends nothing.
 *   - Never affects the booking: it runs after commit, and every failure is
 *     logged and swallowed.
 *   - Studio name, contact address and timezone come from the `studios` row.
 */

import { bookingConfirmationEmail, studioSaleNotificationEmail, type TemplateResult } from "../email/templates.ts";
import {
  customerOptedOut,
  formatWhen,
  lookupOne,
  type NotificationDatabase,
  type NotificationSender,
  type NotificationSendResult,
} from "../stripe-webhook/notifications.ts";
import { bearerToken, hasBearerSecret } from "../_shared/service-auth.ts";

type Row = Record<string, unknown>;
export type BookingNotificationDatabase = {
  from: (table: string) => Omit<ReturnType<NotificationDatabase["from"]>, "insert"> & {
    insert: (values: unknown) => { select: (columns: string) => { maybeSingle: () => Promise<{ data: Row | null; error: unknown }> } };
    update: (values: unknown) => { eq: (column: string, value: unknown) => PromiseLike<{ error: unknown }> };
  };
};

export type BookingNotificationOutcome = { sent: number; skipped: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const isDuplicate = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23505";

export async function sendBookingNotifications({
  bookingId,
  database,
  sendEmail,
  appUrl,
}: {
  bookingId: string;
  database: BookingNotificationDatabase;
  sendEmail: NotificationSender;
  appUrl: string;
}): Promise<BookingNotificationOutcome> {
  const outcome: BookingNotificationOutcome = { sent: 0, skipped: [] };
  try {
    const db = database as unknown as NotificationDatabase;
    const booking = await lookupOne(db, "bookings", "id, studio_id, profile_id, class_occurrence_id, status, transaction_id", bookingId);
    if (!booking) {
      outcome.skipped.push("booking not found");
      return outcome;
    }
    if (booking.status !== "confirmed") {
      outcome.skipped.push("booking is not confirmed");
      return outcome;
    }
    if (booking.transaction_id) {
      outcome.skipped.push("paid through checkout: confirmed by the payment path");
      return outcome;
    }

    const [studio, profile, occurrence] = await Promise.all([
      lookupOne(db, "studios", "name, email, timezone", booking.studio_id),
      lookupOne(db, "profiles", "first_name, last_name, display_name, email", booking.profile_id),
      lookupOne(db, "class_occurrences", "starts_at, ends_at, offering_id, location_id, teacher_id", booking.class_occurrence_id),
    ]);
    if (!studio || !str(studio.name)) {
      outcome.skipped.push("studio not found");
      return outcome;
    }
    const [offering, location, teacher] = await Promise.all([
      lookupOne(db, "offerings", "name, duration_minutes", occurrence?.offering_id),
      lookupOne(db, "locations", "name, address_line1, city", occurrence?.location_id),
      lookupOne(db, "profiles", "first_name, last_name, display_name", occurrence?.teacher_id),
    ]);

    const studioName = str(studio.name);
    const studioEmail = str(studio.email);
    const customerEmail = str(profile?.email);
    const firstName = str(profile?.first_name) || str(profile?.display_name) || "there";
    const customerName = [str(profile?.first_name), str(profile?.last_name)].filter(Boolean).join(" ")
      || str(profile?.display_name) || "A customer";
    const className = str(offering?.name) || "Class";
    const when = occurrence ? formatWhen(occurrence.starts_at, str(studio.timezone) || "UTC") : "";
    const minutes = occurrence
      ? Math.round((new Date(String(occurrence.ends_at)).getTime() - new Date(String(occurrence.starts_at)).getTime()) / 60000)
      : NaN;
    const base = appUrl.replace(/\/+$/, "");

    const deliver = async (
      notificationType: "booking_confirmation" | "studio_booking_notification",
      to: string,
      message: TemplateResult,
      replyTo: string,
      profileId: unknown,
    ) => {
      // Claim first: the unique index makes this the once-per-booking gate.
      const { data: claim, error: claimError } = await database.from("notification_deliveries").insert({
        studio_id: booking.studio_id,
        profile_id: profileId,
        notification_type: notificationType,
        channel: "email",
        subject: message.subject,
        body: message.text,
        related_entity_type: "booking",
        related_entity_id: booking.id,
        status: "pending",
      }).select("id").maybeSingle();
      if (claimError || !claim) {
        outcome.skipped.push(isDuplicate(claimError) ? `${notificationType} already sent` : `${notificationType} could not be claimed`);
        if (!isDuplicate(claimError)) console.error(`[booking-notifications] could not claim ${notificationType} for ${bookingId}`);
        return;
      }

      let result: NotificationSendResult;
      try {
        result = await sendEmail({ to, ...message, replyTo: replyTo || undefined });
      } catch {
        result = { success: false, error: "send threw", provider: "unknown" };
      }
      if (result.success) outcome.sent += 1;
      else {
        outcome.skipped.push(`${notificationType} send failed`);
        console.error(`[booking-notifications] ${notificationType} failed for ${bookingId} (${result.provider})`);
      }
      const now = new Date().toISOString();
      const { error: updateError } = await database.from("notification_deliveries").update({
        status: result.success ? "sent" : "failed",
        sent_at: result.success ? now : null,
        failed_at: result.success ? null : now,
        error_message: result.success ? null : "send failed",
        provider: result.provider,
        provider_message_id: result.messageId ?? null,
      }).eq("id", claim.id);
      if (updateError) console.error("[booking-notifications] could not record delivery status");
    };

    const customer = async () => {
      if (!customerEmail) return void outcome.skipped.push("customer has no email");
      if (await customerOptedOut(db, String(booking.profile_id), String(booking.studio_id), "drop_in")) {
        return void outcome.skipped.push("customer opted out");
      }
      await deliver("booking_confirmation", customerEmail, bookingConfirmationEmail({
        firstName,
        className,
        studioName,
        dateTime: when || "See your schedule for the time",
        duration: Number.isFinite(minutes) && minutes > 0 ? minutes : Number(offering?.duration_minutes) || 60,
        instructor: str(teacher?.display_name) || [str(teacher?.first_name), str(teacher?.last_name)].filter(Boolean).join(" ") || studioName,
        address: [str(location?.name), str(location?.address_line1), str(location?.city)].filter(Boolean).join(", "),
        appUrl: base,
      }), studioEmail, booking.profile_id);
    };
    const studioNotice = async () => {
      if (!studioEmail) return void outcome.skipped.push("studio has no contact email");
      await deliver("studio_booking_notification", studioEmail, studioSaleNotificationEmail({
        studioName,
        kind: "booking",
        customerName,
        customerEmail,
        itemName: className,
        when,
        amount: "",
        manageUrl: `${base}/manage`,
      }), customerEmail, null);
    };
    await Promise.all([customer(), studioNotice()]);
  } catch {
    console.error(`[booking-notifications] failed for ${bookingId}`);
    outcome.skipped.push("unexpected error");
  }
  return outcome;
}

/**
 * HTTP entry. Authenticated by a dedicated shared secret (not the service role
 * key), sent as a bearer token by the database trigger from Supabase Vault.
 * Body: `{ "booking_id": "<uuid>" }`, or a database-webhook payload with
 * `record.id`. Add `"wait": true` to get the outcome instead of 202.
 */
export function createBookingNotificationHandler({
  database,
  sendEmail,
  appUrl,
  getSecret,
  runInBackground,
}: {
  database: BookingNotificationDatabase;
  sendEmail: NotificationSender;
  appUrl: string;
  getSecret: () => string | undefined;
  runInBackground?: (work: Promise<unknown>) => void;
}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!bearerToken(req)) return json({ error: "Not authenticated" }, 401);
    if (!hasBearerSecret(req, getSecret())) return json({ error: "Not authorized" }, 403);

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const record = (payload?.record ?? {}) as Record<string, unknown>;
    const bookingId = str(payload?.booking_id) || str(record.id);
    if (!UUID.test(bookingId)) return json({ error: "Missing or invalid booking_id" }, 400);

    const work = sendBookingNotifications({ bookingId, database, sendEmail, appUrl })
      .then((outcome) => {
        console.log(`[booking-notifications] ${bookingId}: sent=${outcome.sent} skipped=${outcome.skipped.join("; ") || "none"}`);
        return outcome;
      });
    if (payload.wait !== true && runInBackground) {
      runInBackground(work);
      return json({ queued: true }, 202);
    }
    return json(await work);
  };
}
