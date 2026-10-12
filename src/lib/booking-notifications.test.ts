import { describe, expect, it, vi } from "vitest";
import {
  createBookingNotificationHandler,
  sendBookingNotifications,
  type BookingNotificationDatabase,
} from "../../supabase/functions/booking-notifications/handler.ts";
import type { NotificationEmail, NotificationSendResult } from "../../supabase/functions/stripe-webhook/notifications.ts";

type Row = Record<string, unknown>;
const BOOKING = "11111111-1111-4111-8111-111111111111";
const MISSING = "22222222-2222-4222-8222-222222222222";
const secret = "shared-secret-fixture";
const appUrl = "https://book.example.test";

// Fixture studio is deliberately not the deploying client: names and addresses must come from data.
function fixtures(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    bookings: [{ id: BOOKING, studio_id: "studio-1", profile_id: "member-1", class_occurrence_id: "occ-1", status: "confirmed", transaction_id: null }],
    studios: [{ id: "studio-1", name: "Harbour Loft", email: "hello@harbour.example.test", timezone: "Europe/London" }],
    profiles: [
      { id: "member-1", first_name: "Sam", last_name: "Lee", display_name: null, email: "sam@member.example.test" },
      { id: "teacher-1", first_name: "Priya", last_name: "Shah", display_name: null, email: "priya@harbour.example.test" },
    ],
    class_occurrences: [{ id: "occ-1", starts_at: "2026-11-03T18:30:00Z", ends_at: "2026-11-03T19:30:00Z", offering_id: "off-1", location_id: "loc-1", teacher_id: "teacher-1" }],
    offerings: [{ id: "off-1", name: "Strength & Conditioning", duration_minutes: 60 }],
    locations: [{ id: "loc-1", name: "The Barn", address_line1: "1 Mill Lane", city: "Farnham" }],
    notification_preferences: [],
    notification_deliveries: [],
    ...overrides,
  };
}

/** In-memory stand-in that enforces the 00023 unique index on booking email deliveries. */
function databaseMock(tables = fixtures()) {
  let nextId = 1;
  const database = {
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          const rows = (tables[table] ?? []).filter((row) => row[column] === value);
          return Object.assign(Promise.resolve({ data: rows, error: null }), {
            maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
          });
        },
      }),
      insert: (values: unknown) => {
        const row = values as Row;
        const run = () => {
          const clash = (tables[table] ??= []).some((existing) =>
            table === "notification_deliveries" && existing.related_entity_type === "booking" && existing.channel === "email"
            && existing.related_entity_id === row.related_entity_id && existing.notification_type === row.notification_type);
          if (clash) return { data: null, error: { code: "23505" } };
          const stored = { id: `delivery-${nextId++}`, ...row };
          tables[table].push(stored);
          return { data: { id: stored.id }, error: null };
        };
        return Object.assign(Promise.resolve({ error: null }), { select: () => ({ maybeSingle: async () => run() }) });
      },
      update: (values: unknown) => ({
        eq: async (column: string, value: unknown) => {
          for (const row of tables[table] ?? []) if (row[column] === value) Object.assign(row, values as Row);
          return { error: null };
        },
      }),
    }),
  } as unknown as BookingNotificationDatabase;
  return { database, tables };
}

function senderMock(result: Partial<NotificationSendResult> = {}) {
  const sent: NotificationEmail[] = [];
  const sendEmail = vi.fn(async (message: NotificationEmail): Promise<NotificationSendResult> => {
    sent.push(message);
    return { success: true, messageId: `msg-${sent.length}`, provider: "console", ...result };
  });
  return { sendEmail, sent };
}

describe("booking notifications (membership / class pack bookings)", () => {
  it("sends the customer a confirmation and the studio a notice, from studio data", async () => {
    const { database, tables } = databaseMock();
    const { sendEmail, sent } = senderMock();
    const outcome = await sendBookingNotifications({ bookingId: BOOKING, database, sendEmail, appUrl });

    expect(outcome).toEqual({ sent: 2, skipped: [] });
    const customer = sent.find((message) => message.to === "sam@member.example.test")!;
    expect(customer.subject).toBe("Booking Confirmed: Strength & Conditioning");
    expect(customer.replyTo).toBe("hello@harbour.example.test");
    expect(customer.text).toMatch(/3 November 2026/);
    expect(customer.text).toContain("with Priya Shah");
    expect(customer.html).toContain("Harbour Loft");
    expect(customer.html).not.toMatch(/tandava|roam/i);
    const studio = sent.find((message) => message.to === "hello@harbour.example.test")!;
    expect(studio.subject).toBe("New booking: Strength & Conditioning - Sam Lee");
    expect(studio.replyTo).toBe("sam@member.example.test");
    expect(studio.text).not.toContain("Paid:");

    expect(tables.notification_deliveries.map((row) => [row.notification_type, row.status, row.related_entity_type, row.related_entity_id]).sort()).toEqual([
      ["booking_confirmation", "sent", "booking", BOOKING],
      ["studio_booking_notification", "sent", "booking", BOOKING],
    ]);
  });

  it("is idempotent per booking: a repeated or concurrent call sends nothing more", async () => {
    const { database, tables } = databaseMock();
    const { sendEmail } = senderMock();
    const [first, second] = await Promise.all([
      sendBookingNotifications({ bookingId: BOOKING, database, sendEmail, appUrl }),
      sendBookingNotifications({ bookingId: BOOKING, database, sendEmail, appUrl }),
    ]);
    const third = await sendBookingNotifications({ bookingId: BOOKING, database, sendEmail, appUrl });
    expect(first.sent + second.sent).toBe(2);
    expect(third).toEqual({ sent: 0, skipped: expect.arrayContaining(["booking_confirmation already sent", "studio_booking_notification already sent"]) });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(tables.notification_deliveries).toHaveLength(2);
  });

  it("does not retry a failed send for the same booking (at most once)", async () => {
    const { database, tables } = databaseMock();
    const failing = senderMock({ success: false, error: "provider detail that must not be stored" });
    expect((await sendBookingNotifications({ bookingId: BOOKING, database, sendEmail: failing.sendEmail, appUrl })).sent).toBe(0);
    expect(tables.notification_deliveries.map((row) => row.status)).toEqual(["failed", "failed"]);
    expect(JSON.stringify(tables.notification_deliveries)).not.toContain("provider detail");
    const { sendEmail } = senderMock();
    expect((await sendBookingNotifications({ bookingId: BOOKING, database, sendEmail, appUrl })).sent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown booking id", MISSING, {}, "booking not found"],
    ["a waitlisted booking", BOOKING, { status: "waitlisted" }, "booking is not confirmed"],
    ["a cancelled booking", BOOKING, { status: "cancelled" }, "booking is not confirmed"],
    ["a Stripe Checkout drop-in (already confirmed by the payment path)", BOOKING, { transaction_id: "txn-1" }, "paid through checkout: confirmed by the payment path"],
  ])("sends nothing for %s", async (_label, bookingId, patch, reason) => {
    const base = fixtures();
    const { database, tables } = databaseMock(fixtures({ bookings: [{ ...base.bookings[0], ...patch }] }));
    const { sendEmail } = senderMock();
    expect(await sendBookingNotifications({ bookingId, database, sendEmail, appUrl })).toEqual({ sent: 0, skipped: [reason] });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(tables.notification_deliveries).toHaveLength(0);
  });

  it("respects the member's opt-out and a studio without a contact email", async () => {
    const optedOut = databaseMock(fixtures({ notification_preferences: [{ profile_id: "member-1", studio_id: null, email_enabled: true, booking_confirmations: false, payment_alerts: true }] }));
    const first = senderMock();
    expect(await sendBookingNotifications({ bookingId: BOOKING, database: optedOut.database, sendEmail: first.sendEmail, appUrl })).toEqual({ sent: 1, skipped: ["customer opted out"] });
    expect(first.sent.map((message) => message.to)).toEqual(["hello@harbour.example.test"]);

    const noStudioEmail = databaseMock(fixtures({ studios: [{ id: "studio-1", name: "Harbour Loft", email: null, timezone: "Europe/London" }] }));
    const second = senderMock();
    expect(await sendBookingNotifications({ bookingId: BOOKING, database: noStudioEmail.database, sendEmail: second.sendEmail, appUrl })).toEqual({ sent: 1, skipped: ["studio has no contact email"] });
  });

  it("never throws when the provider throws or the database is down", async () => {
    const { database } = databaseMock();
    const sendEmail = vi.fn(async () => { throw new Error("network down"); });
    await expect(sendBookingNotifications({ bookingId: BOOKING, database, sendEmail, appUrl })).resolves.toMatchObject({ sent: 0 });
    const broken = { from: () => { throw new Error("database down"); } } as unknown as BookingNotificationDatabase;
    await expect(sendBookingNotifications({ bookingId: BOOKING, database: broken, sendEmail: senderMock().sendEmail, appUrl })).resolves.toEqual({ sent: 0, skipped: ["unexpected error"] });
  });
});

describe("booking-notifications HTTP handler", () => {
  function setup(runInBackground?: (work: Promise<unknown>) => void) {
    const { database } = databaseMock();
    const { sendEmail } = senderMock();
    const handler = createBookingNotificationHandler({ database, sendEmail, appUrl, getSecret: () => secret, runInBackground });
    return { handler, sendEmail };
  }
  const post = (body: unknown, token?: string) => new Request("https://test.invalid/functions/v1/booking-notifications", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  it("requires the shared secret: none 401, wrong 403, and never sends", async () => {
    const { handler, sendEmail } = setup();
    expect((await handler(post({ booking_id: BOOKING }))).status).toBe(401);
    for (const token of ["wrong", `${secret}x`, secret.slice(0, -1), "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fixture"]) {
      expect((await handler(post({ booking_id: BOOKING }, token))).status).toBe(403);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is not configured", async () => {
    const { database } = databaseMock();
    const { sendEmail } = senderMock();
    for (const configured of [undefined, ""]) {
      const handler = createBookingNotificationHandler({ database, sendEmail, appUrl, getSecret: () => configured });
      expect((await handler(post({ booking_id: BOOKING }, "anything"))).status).toBe(403);
      expect((await handler(post({ booking_id: BOOKING }, ""))).status).toBe(401);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects other methods and bad bodies", async () => {
    const { handler } = setup();
    expect((await handler(new Request("https://test.invalid", { method: "GET" }))).status).toBe(405);
    expect((await handler(post("not json", secret))).status).toBe(400);
    expect((await handler(post({}, secret))).status).toBe(400);
    expect((await handler(post({ booking_id: "1; drop table bookings" }, secret))).status).toBe(400);
  });

  it("accepts a booking id or a database-webhook record and reports the outcome", async () => {
    const { handler, sendEmail } = setup();
    const response = await handler(post({ booking_id: BOOKING }, secret));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 2, skipped: [] });
    const replay = await handler(post({ type: "INSERT", table: "bookings", record: { id: BOOKING } }, secret));
    expect(await replay.json()).toMatchObject({ sent: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("handles an unknown booking id cleanly", async () => {
    const { handler, sendEmail } = setup();
    const response = await handler(post({ booking_id: MISSING }, secret));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 0, skipped: ["booking not found"] });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("answers 202 at once and finishes in the background when the runtime allows it", async () => {
    const pending: Promise<unknown>[] = [];
    const { handler, sendEmail } = setup((work) => pending.push(work));
    const response = await handler(post({ booking_id: BOOKING }, secret));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ queued: true });
    await Promise.all(pending);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect((await handler(post({ booking_id: MISSING, wait: true }, secret))).status).toBe(200);
  });
});
