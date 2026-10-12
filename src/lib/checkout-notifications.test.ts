import { describe, expect, it, vi } from "vitest";
import {
  sendCheckoutNotifications,
  type NotificationDatabase,
  type NotificationEmail,
  type NotificationSendResult,
} from "../../supabase/functions/stripe-webhook/notifications.ts";

// Fixture studio is deliberately not the deploying client: names and addresses must come from data.
type Row = Record<string, unknown>;
function fixtures(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    studios: [{ id: "studio-1", name: "Harbour <Yoga> Loft", email: "hello@harbour.example.test", timezone: "Europe/London", currency: "GBP" }],
    profiles: [
      { id: "member-1", first_name: "Sam", last_name: "O'Neil", display_name: null, email: "sam@member.example.test" },
      { id: "teacher-1", first_name: "Priya", last_name: "Shah", display_name: null, email: "priya@harbour.example.test" },
    ],
    class_occurrences: [{ id: "occ-1", starts_at: "2026-11-03T18:30:00Z", ends_at: "2026-11-03T19:15:00Z", offering_id: "off-1", location_id: "loc-1", teacher_id: "teacher-1" }],
    offerings: [{ id: "off-1", name: "Strength & Conditioning", duration_minutes: 60 }],
    locations: [{ id: "loc-1", name: "The Barn", address_line1: "1 Mill Lane", city: "Farnham" }],
    class_pack_types: [{ id: "pack-1", name: "10 Class Pass", class_count: 10 }],
    membership_types: [{ id: "mem-1", name: "Unlimited Monthly" }],
    events: [{ id: "event-1", title: "Mobility Workshop" }],
    notification_preferences: [],
    ...overrides,
  };
}

function databaseMock(tables = fixtures()) {
  const inserts: Array<{ table: string; values: Row }> = [];
  const database: NotificationDatabase = {
    from: (table) => ({
      select: () => ({
        eq: (column, value) => {
          const rows = (tables[table] ?? []).filter((row) => row[column] === value);
          return Object.assign(Promise.resolve({ data: rows, error: null }), {
            maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
          });
        },
      }),
      insert: (values) => {
        inserts.push({ table, values: values as Row });
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { database, inserts };
}

function senderMock(result: Partial<NotificationSendResult> = {}) {
  const sent: NotificationEmail[] = [];
  const sendEmail = vi.fn(async (message: NotificationEmail): Promise<NotificationSendResult> => {
    sent.push(message);
    return { success: true, messageId: `msg-${sent.length}`, provider: "console", ...result };
  });
  return { sendEmail, sent };
}

function checkoutEvent(metadata: Record<string, string>, session: Row = {}) {
  return {
    id: "evt_fixture",
    type: "checkout.session.completed",
    data: { object: { id: "cs_fixture", amount_total: 1200, currency: "gbp", metadata: { studio_id: "studio-1", profile_id: "member-1", ...metadata }, ...session } },
  };
}
const appUrl = "https://book.example.test/";
const dropIn = () => checkoutEvent({ type: "drop_in", occurrence_id: "occ-1" });

describe("checkout notifications", () => {
  it("drop-in: sends the customer a booking confirmation and the studio a notification", async () => {
    const { database, inserts } = databaseMock();
    const { sendEmail, sent } = senderMock();
    const outcome = await sendCheckoutNotifications({ event: dropIn(), database, sendEmail, appUrl });

    expect(outcome).toEqual({ sent: 2, skipped: [] });
    const customer = sent.find((message) => message.to === "sam@member.example.test")!;
    expect(customer.subject).toBe("Booking Confirmed: Strength & Conditioning");
    expect(customer.replyTo).toBe("hello@harbour.example.test");
    expect(customer.text).toMatch(/Tuesday,? 3 November 2026/);
    expect(customer.text).toContain("18:30");
    expect(customer.text).toContain("45 min");
    expect(customer.text).toContain("with Priya Shah");
    expect(customer.text).toContain("The Barn, 1 Mill Lane, Farnham");
    expect(customer.text).toContain("https://book.example.test/my-schedule");

    const studio = sent.find((message) => message.to === "hello@harbour.example.test")!;
    expect(studio.subject).toBe("New booking: Strength & Conditioning - Sam O'Neil");
    expect(studio.replyTo).toBe("sam@member.example.test");
    expect(studio.text).toContain("Paid: £12.00");
    expect(studio.text).toContain("https://book.example.test/manage");

    expect(inserts.map((insert) => [insert.table, insert.values.notification_type, insert.values.status]).sort()).toEqual([
      ["notification_deliveries", "booking_confirmation", "sent"],
      ["notification_deliveries", "studio_sale_notification", "sent"],
    ]);
  });

  it("brands the mail with the studio's own name and escapes it", async () => {
    const { database } = databaseMock();
    const { sendEmail, sent } = senderMock();
    await sendCheckoutNotifications({ event: dropIn(), database, sendEmail, appUrl });
    for (const message of sent) {
      expect(message.html).toContain("Harbour &lt;Yoga&gt; Loft");
      expect(message.html).not.toContain("<Yoga>");
      expect(message.html).not.toMatch(/tandava|roam/i);
    }
    expect(sent[0].html + sent[1].html).toContain("Sam O&#39;Neil");
  });

  it.each([
    ["class_pack", { type: "class_pack", class_pack_type_id: "pack-1" }, "10 Class Pass (10 classes)"],
    ["membership", { type: "membership", membership_type_id: "mem-1" }, "Unlimited Monthly"],
    ["workshop", { type: "workshop", event_id: "event-1" }, "Mobility Workshop"],
  ])("%s: sends a purchase confirmation and a sale notification", async (_kind, metadata, itemName) => {
    const { database, inserts } = databaseMock();
    const { sendEmail, sent } = senderMock();
    const outcome = await sendCheckoutNotifications({ event: checkoutEvent(metadata), database, sendEmail, appUrl });
    expect(outcome.sent).toBe(2);
    expect(sent[0].subject).toBe(`Payment confirmed: ${itemName} at Harbour <Yoga> Loft`);
    expect(sent[0].text).toContain("Amount paid: £12.00");
    expect(sent.find((message) => message.to === "hello@harbour.example.test")!.subject).toBe(`New sale: ${itemName} - Sam O'Neil`);
    expect(inserts.some((insert) => insert.values.notification_type === "purchase_confirmation")).toBe(true);
  });

  it("respects the member's email opt-out but still tells the studio", async () => {
    for (const preference of [
      { profile_id: "member-1", studio_id: null, email_enabled: false, booking_confirmations: true, payment_alerts: true },
      { profile_id: "member-1", studio_id: "studio-1", email_enabled: true, booking_confirmations: false, payment_alerts: true },
    ]) {
      const { database } = databaseMock(fixtures({ notification_preferences: [preference] }));
      const { sendEmail, sent } = senderMock();
      const outcome = await sendCheckoutNotifications({ event: dropIn(), database, sendEmail, appUrl });
      expect(outcome.skipped).toEqual(["customer opted out"]);
      expect(sent.map((message) => message.to)).toEqual(["hello@harbour.example.test"]);
    }
  });

  it("lets a studio-specific preference override a global opt-out of this category", async () => {
    const { database } = databaseMock(fixtures({ notification_preferences: [
      { profile_id: "member-1", studio_id: null, email_enabled: true, booking_confirmations: false, payment_alerts: true },
      { profile_id: "member-1", studio_id: "studio-1", email_enabled: true, booking_confirmations: true, payment_alerts: true },
    ] }));
    const { sendEmail } = senderMock();
    expect((await sendCheckoutNotifications({ event: dropIn(), database, sendEmail, appUrl })).sent).toBe(2);
  });

  it("skips the studio notification when the studio has no contact email", async () => {
    const { database } = databaseMock(fixtures({ studios: [{ id: "studio-1", name: "Harbour Loft", email: null, timezone: "Europe/London", currency: "GBP" }] }));
    const { sendEmail, sent } = senderMock();
    const outcome = await sendCheckoutNotifications({ event: dropIn(), database, sendEmail, appUrl });
    expect(outcome).toEqual({ sent: 1, skipped: ["studio has no contact email"] });
    expect(sent[0].replyTo).toBeUndefined();
  });

  it("never throws when the provider fails or throws, and records the failure", async () => {
    const failing = databaseMock();
    const failed = senderMock({ success: false, error: "provider detail that must not be stored" });
    const outcome = await sendCheckoutNotifications({ event: dropIn(), database: failing.database, sendEmail: failed.sendEmail, appUrl });
    expect(outcome.sent).toBe(0);
    expect(failing.inserts.map((insert) => insert.values.status)).toEqual(["failed", "failed"]);
    expect(JSON.stringify(failing.inserts)).not.toContain("provider detail");

    const throwing = databaseMock();
    const sendEmail = vi.fn(async () => { throw new Error("network down"); });
    await expect(sendCheckoutNotifications({ event: dropIn(), database: throwing.database, sendEmail, appUrl })).resolves.toMatchObject({ sent: 0 });
  });

  it("never throws when the database is unavailable", async () => {
    const database = { from: () => { throw new Error("database down"); } } as unknown as NotificationDatabase;
    const { sendEmail } = senderMock();
    await expect(sendCheckoutNotifications({ event: dropIn(), database, sendEmail, appUrl })).resolves.toEqual({ sent: 0, skipped: ["unexpected error"] });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for other events, unknown checkout types or an unknown studio", async () => {
    const { database } = databaseMock();
    const { sendEmail } = senderMock();
    await sendCheckoutNotifications({ event: { id: "evt_x", type: "invoice.payment_succeeded", data: { object: {} } }, database, sendEmail, appUrl });
    await sendCheckoutNotifications({ event: checkoutEvent({ type: "gift_card" }), database, sendEmail, appUrl });
    await sendCheckoutNotifications({ event: checkoutEvent({ type: "drop_in", occurrence_id: "occ-1", studio_id: "missing" }), database, sendEmail, appUrl });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
