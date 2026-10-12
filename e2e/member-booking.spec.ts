import { expect, test } from "@playwright/test";
import { db, env, forwardCheckoutWebhook, newMember, payWithTestCard, profileIdFor, registerFromBookingLink, waitFor } from "./helpers";

/**
 * The member booking journey against a LOCAL Supabase stack and Stripe TEST mode:
 * real sign-up through the API, real hosted Checkout with the published test card,
 * the real Stripe event delivered to the local stripe-webhook function, real
 * book_class / cancel_booking RPCs under the member's own session.
 */

type Occurrence = { id: string; starts_at: string; offering_id: string };
const PACK_NAME = "E2E 5 Class Pass";
const base = `/s/${env.slug}`;
let studioId = "";
let occurrences: Occurrence[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const [studio] = await db<Array<{ id: string }>>("GET", `studios?select=id&slug=eq.${env.slug}`);
  expect(studio, "local seed studio").toBeTruthy();
  studioId = studio.id;
  // Local fixtures only: the seed deliberately has no prices, so give the test something to buy.
  await db("PATCH", `studios?id=eq.${studioId}`, { email: "studio-e2e@example.com", discoverable: true });
  await db("PATCH", `offerings?studio_id=eq.${studioId}`, { drop_in_price_cents: 1200 });
  const existing = await db<Array<{ id: string }>>("GET", `class_pack_types?select=id&studio_id=eq.${studioId}&name=eq.${encodeURIComponent(PACK_NAME)}`);
  if (existing.length === 0) {
    await db("POST", "class_pack_types", { studio_id: studioId, name: PACK_NAME, class_count: 5, price_cents: 4500, validity_days: 90, is_active: true });
  }
  // Sessions far enough ahead to be outside the studio's cancellation window.
  const from = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  occurrences = await db<Occurrence[]>("GET", `class_occurrences?select=id,starts_at,offering_id&studio_id=eq.${studioId}&is_cancelled=eq.false&starts_at=gte.${encodeURIComponent(from)}&order=starts_at.asc&limit=4`);
  expect(occurrences.length, "upcoming sessions in the local seed").toBeGreaterThanOrEqual(2);
});

test("register, buy a pass with a test card, book with it, see it in My bookings, cancel", async ({ page }) => {
  const member = newMember("pack");
  const occurrence = occurrences[0];
  const startedAt = Math.floor(Date.now() / 1000);

  // Storefront -> schedule -> class, signed out.
  await page.goto(base);
  await page.getByTestId("storefront-schedule").click();
  await expect(page.getByTestId("schedule-list")).toBeVisible();
  const before = await db<Array<{ booked_count: number; capacity: number }>>("GET", `class_occurrences?select=booked_count,capacity&id=eq.${occurrence.id}`);
  await page.locator(`[data-testid="schedule-class"][data-occurrence="${occurrence.id}"]`).click();
  await expect(page.getByTestId("class-detail")).toBeVisible();
  await expect(page.getByTestId("class-availability")).toContainText(`${before[0].capacity - before[0].booked_count} spaces left`);
  await expect(page.getByTestId("booking-signed-out")).toBeVisible();

  // Register through the real form; come back to the same class, signed in.
  await registerFromBookingLink(page, member);
  await expect(page).toHaveURL(new RegExp(`${base}/class/${occurrence.id}`));
  const profileId = await profileIdFor(member.email);
  await expect(page.getByTestId("booking-options")).toBeVisible();
  await expect(page.getByTestId("book-with-pass")).toHaveCount(0); // no pass yet

  // Buy the pass through Stripe Checkout.
  await page.getByTestId("see-passes").click();
  await page.locator('[data-testid="plan-pack"]', { hasText: PACK_NAME }).getByTestId("buy-pack").click();
  await payWithTestCard(page, member.email);

  // Back in the app: no pass until the webhook has been processed.
  await page.waitForURL(new RegExp(`${base}/checkout/success`), { timeout: 90_000 });
  await expect(page.getByTestId("checkout-checking")).toBeVisible();
  expect(await db<unknown[]>("GET", `class_packs?select=id&profile_id=eq.${profileId}`)).toHaveLength(0);

  const webhook = await forwardCheckoutWebhook(profileId, startedAt);
  expect(webhook.first.status).toBe(200);
  expect(JSON.parse(webhook.first.body)).toEqual({ received: true });
  await expect(page.getByTestId("checkout-confirmed")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("checkout-confirmed")).toHaveAttribute("data-kind", "class_pack");

  // A replayed delivery must not grant a second pass.
  const replay = await webhook.deliver();
  expect(JSON.parse(replay.body)).toMatchObject({ received: true, duplicate: true });
  const packs = await db<Array<{ id: string; classes_remaining: number; classes_total: number }>>("GET", `class_packs?select=id,classes_remaining,classes_total&profile_id=eq.${profileId}`);
  expect(packs).toHaveLength(1);
  expect(packs[0]).toMatchObject({ classes_remaining: 5, classes_total: 5 });

  // Book the class with the pass (book_class RPC as this member).
  await page.goto(`${base}/class/${occurrence.id}`);
  await page.getByTestId("book-with-pass").click();
  await expect(page.getByTestId("booking-notice")).toContainText("You are booked in");
  await expect(page.getByTestId("booking-mine")).toBeVisible();
  const [booking] = await db<Array<{ id: string; status: string; class_pack_id: string; transaction_id: string | null }>>(
    "GET", `bookings?select=id,status,class_pack_id,transaction_id&profile_id=eq.${profileId}&class_occurrence_id=eq.${occurrence.id}`);
  expect(booking).toMatchObject({ status: "confirmed", class_pack_id: packs[0].id, transaction_id: null });
  const afterBook = await db<Array<{ booked_count: number }>>("GET", `class_occurrences?select=booked_count&id=eq.${occurrence.id}`);
  expect(afterBook[0].booked_count).toBe(before[0].booked_count + 1);

  // The database trigger asks the booking-notifications function for a confirmation email.
  const deliveries = await waitFor("booking confirmation delivery rows", async () => {
    const rows = await db<Array<{ notification_type: string; status: string }>>(
      "GET", `notification_deliveries?select=notification_type,status&related_entity_type=eq.booking&related_entity_id=eq.${booking.id}`);
    return rows.length >= 2 && rows.every((row) => row.status !== "pending") ? rows : null;
  }, 60_000);
  expect(deliveries.map((row) => row.notification_type).sort()).toEqual(["booking_confirmation", "studio_booking_notification"]);
  expect(deliveries.every((row) => row.status === "sent")).toBe(true);

  // My bookings: the booking is there and the pass is one class down.
  await page.goto(`${base}/my`);
  const mine = page.locator(`[data-testid="my-upcoming"] [data-testid="my-booking"][data-occurrence="${occurrence.id}"]`);
  await expect(mine).toBeVisible();
  await expect(mine).toHaveAttribute("data-status", "confirmed");
  await expect(page.getByTestId("my-pack-remaining")).toHaveText("4");

  // Schedule shows it as booked for this member.
  await page.goto(`${base}/schedule`);
  await expect(page.locator(`[data-testid="schedule-class"][data-occurrence="${occurrence.id}"] [data-testid="schedule-booked"]`)).toBeVisible();

  // Cancel (outside the cancellation window): the class goes back on the pass.
  await page.goto(`${base}/my`);
  await mine.getByTestId("my-booking-cancel").click();
  await expect(page.getByTestId("my-notice")).toContainText("is cancelled");
  await expect(page.getByTestId("my-upcoming-empty")).toBeVisible();
  await expect(page.getByTestId("my-pack-remaining")).toHaveText("5");
  const [cancelled] = await db<Array<{ status: string }>>("GET", `bookings?select=status&id=eq.${booking.id}`);
  expect(cancelled.status).toBe("cancelled");

  // Booking the same class again after cancelling works (was blocked by a table-wide unique constraint).
  await page.goto(`${base}/class/${occurrence.id}`);
  await page.getByTestId("book-with-pass").click();
  await expect(page.getByTestId("booking-notice")).toContainText("You are booked in");
  const active = await db<unknown[]>("GET", `bookings?select=id&profile_id=eq.${profileId}&class_occurrence_id=eq.${occurrence.id}&status=eq.confirmed`);
  expect(active).toHaveLength(1);
});

test("pay for a single class with a test card: booking exists and a confirmation email is attempted", async ({ page }) => {
  const member = newMember("dropin");
  const occurrence = occurrences[1];
  const startedAt = Math.floor(Date.now() / 1000);

  await page.goto(`${base}/class/${occurrence.id}`);
  await expect(page.getByTestId("booking-signed-out")).toBeVisible();
  await registerFromBookingLink(page, member);
  await expect(page).toHaveURL(new RegExp(`${base}/class/${occurrence.id}`));
  const profileId = await profileIdFor(member.email);

  await page.getByTestId("pay-drop-in").click();
  await payWithTestCard(page, member.email);
  await page.waitForURL(new RegExp(`${base}/checkout/success`), { timeout: 90_000 });
  await expect(page.getByTestId("checkout-checking")).toBeVisible();
  expect(await db<unknown[]>("GET", `bookings?select=id&profile_id=eq.${profileId}`)).toHaveLength(0);

  const webhook = await forwardCheckoutWebhook(profileId, startedAt);
  expect(webhook.first.status).toBe(200);
  await expect(page.getByTestId("checkout-confirmed")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("checkout-confirmed")).toHaveAttribute("data-kind", "drop_in");

  // Real rows: a completed transaction and a confirmed booking linked to it.
  const [booking] = await db<Array<{ id: string; status: string; transaction_id: string | null }>>(
    "GET", `bookings?select=id,status,transaction_id&profile_id=eq.${profileId}&class_occurrence_id=eq.${occurrence.id}`);
  expect(booking.status).toBe("confirmed");
  expect(booking.transaction_id).toBeTruthy();
  const [transaction] = await db<Array<{ type: string; status: string; amount_cents: number }>>("GET", `transactions?select=type,status,amount_cents&id=eq.${booking.transaction_id}`);
  expect(transaction).toEqual({ type: "drop_in", status: "completed", amount_cents: 1200 });

  // Confirmation email attempted once by the payment path (customer + studio), not again by the booking trigger.
  const deliveries = await waitFor("checkout notification delivery rows", async () => {
    const rows = await db<Array<{ notification_type: string; status: string; related_entity_type: string }>>(
      "GET", `notification_deliveries?select=notification_type,status,related_entity_type&studio_id=eq.${studioId}&or=(profile_id.eq.${profileId},and(profile_id.is.null,related_entity_id.eq.${occurrence.id}))`);
    return rows.some((row) => row.notification_type === "booking_confirmation") ? rows : null;
  }, 60_000);
  const customer = deliveries.filter((row) => row.notification_type === "booking_confirmation");
  expect(customer).toHaveLength(1);
  expect(customer[0]).toMatchObject({ status: "sent", related_entity_type: "class_occurrence" });
  expect(await db<unknown[]>("GET", `notification_deliveries?select=id&related_entity_type=eq.booking&related_entity_id=eq.${booking.id}`)).toHaveLength(0);

  // A replay does not book or charge twice.
  const replay = await webhook.deliver();
  expect(JSON.parse(replay.body)).toMatchObject({ duplicate: true });
  expect(await db<unknown[]>("GET", `bookings?select=id&profile_id=eq.${profileId}`)).toHaveLength(1);

  await page.getByTestId("checkout-continue").click();
  const mine = page.locator(`[data-testid="my-upcoming"] [data-testid="my-booking"][data-occurrence="${occurrence.id}"]`);
  await expect(mine).toBeVisible();
  await expect(mine).toContainText("Paid online");

  // Trying to pay for the same class again is refused with a clear message.
  await page.goto(`${base}/class/${occurrence.id}`);
  await expect(page.getByTestId("booking-mine")).toBeVisible();
  await expect(page.getByTestId("pay-drop-in")).toHaveCount(0);
});

test("a visitor who abandons payment is told nothing was charged", async ({ page }) => {
  await page.goto(`${base}/checkout/cancelled?kind=class_pack&t=${Date.now()}`);
  await expect(page.getByTestId("checkout-cancelled")).toBeVisible();
  await expect(page.getByTestId("checkout-cancelled")).toContainText("nothing has been charged");
});
