/**
 * Owner (studio admin) end-to-end test, on a real local Supabase stack.
 *
 * One story, in order:
 *   1. Before a studio exists, a signed-up account that is not on the owner
 *      allow-list cannot open studio setup or create a studio, by any route.
 *   2. The allow-listed owner registers, runs the setup wizard, creates a class
 *      type, a weekly schedule and a one-off session (edit + cancel), sets a
 *      drop-in price, a class pack and a membership.
 *   3. An anonymous visitor sees all of it on the public booking page.
 *   4. A member signs up; the Stripe webhook records their class-pack purchase;
 *      the owner finds them, books them in, marks attendance and sees the payment.
 *   5. With the studio in place, other accounts still cannot reach /manage or
 *      touch the studio's data.
 *   6. The owner screens fit a phone.
 *
 * Start the stack first: scripts/e2e-stack.sh up
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PASSWORD, anonClient, callFunction, dateInZone, deliverCheckoutCompleted, signIn, signUp, sql, sqlFails } from "./support";

const run = Date.now().toString(36);
const OWNER = { email: `owner-${run}@e2e.example.test`, first: "Olive", last: "Owner" };
const INTRUDER = { email: `intruder-${run}@e2e.example.test`, first: "Ivan", last: "Intruder" };
const LATE = { email: `late-${run}@e2e.example.test`, first: "Lara", last: "Latecomer" };
const MEMBER = { email: `member-${run}@e2e.example.test`, first: "Mia", last: "Member" };
const STUDIO = { name: "E2E Athletics", slug: "e2e-athletics", timezone: "Europe/London" };

let ownerContext: BrowserContext;
let owner: Page;
let intruderContext: BrowserContext;
let intruder: Page;
const consoleErrors: string[] = [];

function watchConsole(page: Page, who: string) {
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${who} console: ${message.text()} @ ${page.url()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${who} page error: ${error.message} @ ${page.url()}`));
}

async function register(page: Page, person: { email: string; first: string; last: string }) {
  await page.goto("/auth/register");
  await page.locator("#firstName").fill(person.first);
  await page.locator("#lastName").fill(person.last);
  await page.locator("#email").fill(person.email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#terms").click();
  await page.locator('button[type="submit"]').click();
  // The welcome screen replaces the form once the account exists and is signed in.
  await expect(page.locator("#firstName")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(person.first);
}

async function expectTurnedAway(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Not available yet" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
}

const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const sessionRows = (page: Page) => page.getByTestId("session-row");

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  // Known starting state: no studio (the local seed's sample studio is removed),
  // no users (this stack exists only for these tests), single-studio mode on, one allow-listed owner email.
  sql(`
    UPDATE deployment_settings SET single_studio_mode = FALSE;
    DELETE FROM studios;
    DELETE FROM auth.users;
    UPDATE deployment_settings SET single_studio_mode = TRUE, owner_email_allowlist = ARRAY['${OWNER.email.toUpperCase()}'];
  `);
  ownerContext = await browser.newContext();
  owner = await ownerContext.newPage();
  watchConsole(owner, "owner");
  intruderContext = await browser.newContext();
  intruder = await intruderContext.newPage();
  watchConsole(intruder, "intruder");
});

test.afterAll(async () => {
  await ownerContext?.close();
  await intruderContext?.close();
});

test("a visitor who is not signed in is sent to sign-in from every owner screen", async ({ page }) => {
  for (const path of ["/manage", "/manage/schedule", "/manage/offerings", "/manage/students", "/manage/financials", "/manage/onboarding"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/login$/);
  }
});

test("before a studio exists, an account that is not allow-listed cannot create one", async () => {
  await register(intruder, INTRUDER);
  await expectTurnedAway(intruder, "/manage/onboarding");
  await expectTurnedAway(intruder, "/manage");

  // The same refusal at every layer underneath the screen.
  const api = await signIn(INTRUDER.email);
  const access = await api.client.rpc("studio_setup_access");
  expect(access.data).toMatchObject({ single_studio_mode: true, studio_exists: false, can_create_studio: false, can_open_setup: false });
  expect((await callFunction(api, "onboarding", { step: "status" })).status).toBe(403);
  expect((await callFunction(api, "onboarding", { step: "studio", data: { studioName: "Hijacked Studio" } })).status).toBe(403);
  expect((await api.client.rpc("create_studio_for_owner", { p_owner_id: api.id, p_name: "Hijacked", p_slug: "hijacked" })).error).not.toBeNull();
  expect((await api.client.from("studios").insert({ name: "Hijacked", slug: "hijacked" })).error).not.toBeNull();
  expect((await api.client.from("deployment_settings").update({ single_studio_mode: false }).eq("id", true).select()).data ?? []).toHaveLength(0);
  // Even with database-owner rights, a studio cannot be inserted outside studio setup.
  expect(sqlFails(`INSERT INTO studios (name, slug) VALUES ('Hijacked', 'hijacked');`)).toBe(true);
  expect(sql("SELECT COUNT(*) FROM studios")).toBe("0");
});

test("the allow-listed owner registers and completes the setup wizard", async () => {
  await register(owner, OWNER);
  await owner.goto("/");
  await expect(owner).toHaveURL(/\/manage\/onboarding$/);
  await expect(owner.getByRole("heading", { name: "Studio Setup" })).toBeVisible();
  await expect(owner.getByText("Restoring your progress")).toHaveCount(0);

  await owner.locator("#studioName").fill(STUDIO.name);
  await owner.locator("#studioDesc").fill("Strength and conditioning for the end-to-end test.");
  await owner.getByRole("combobox").nth(0).click();
  await owner.getByRole("option", { name: "UK (London)" }).click();
  await owner.getByRole("combobox").nth(1).click();
  await owner.getByRole("option", { name: "GBP" }).click();
  await owner.getByRole("button", { name: /Save & Continue/ }).click();
  await expect(owner.getByRole("heading", { name: "Location" })).toBeVisible();

  await owner.locator("#address").fill("1 Test Lane, Farnham");
  await owner.locator("#rooms").fill("Main room");
  await owner.getByRole("button", { name: /Save & Continue/ }).click();
  await expect(owner.getByRole("heading", { name: "Branding" })).toBeVisible();

  await owner.getByRole("button", { name: "Launch", exact: true }).click();
  await expect(owner.getByRole("heading", { name: "Ready to Launch" })).toBeVisible();
  await owner.getByRole("switch").click();
  await owner.getByRole("button", { name: "Launch Studio" }).click();
  await expect(owner).toHaveURL(/\/manage$/);

  expect(sql("SELECT slug || '|' || timezone || '|' || currency || '|' || discoverable FROM studios")).toBe(`${STUDIO.slug}|${STUDIO.timezone}|GBP|true`);
  expect(sql(`SELECT role FROM studio_staff ss JOIN profiles p ON p.id = ss.profile_id WHERE p.email = '${OWNER.email}'`)).toBe("owner");
});

test("a new studio's dashboard shows real zeroes and empty states", async () => {
  await expect(owner.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(owner.getByTestId("stat-sessions-today")).toHaveText("0");
  await expect(owner.getByTestId("stat-bookings-today")).toHaveText("0");
  await expect(owner.getByTestId("stat-upcoming")).toHaveText("0");
  await expect(owner.getByText("No sessions today")).toBeVisible();
  await expect(owner.getByText("Nothing scheduled after today")).toBeVisible();
  await expect(owner.getByRole("switch", { name: "Public booking page" })).toBeChecked();
  // The account that registered before the studio existed is its first member.
  await expect(owner.getByTestId("stat-members")).toHaveText("1");

  for (const [link, empty] of [["Members", null], ["Prices", "No class packs"], ["Payments", "No payments yet"]] as const) {
    await nav(owner, link).click();
    await expect(owner.getByRole("heading", { name: link, level: 1 })).toBeVisible();
    if (empty) await expect(owner.getByText(empty, { exact: true })).toBeVisible();
  }
});

test("the owner creates a class type, a weekly schedule and a one-off session, then edits and cancels a session", async () => {
  await nav(owner, "Classes").click();
  await expect(owner.getByText("No classes yet")).toBeVisible();

  // Class type
  await owner.getByRole("button", { name: "New class type" }).first().click();
  let dialog = owner.getByRole("dialog");
  await dialog.locator("#class-name").fill("Strength");
  await dialog.locator("#class-description").fill("Barbell basics in a small group.");
  await dialog.locator("#class-duration").fill("45");
  await dialog.locator("#class-capacity").fill("8");
  await dialog.locator("#class-price").fill("15");
  await dialog.getByRole("button", { name: "Save class type" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(owner.getByText("Nothing on the schedule")).toBeVisible();

  // Weekly schedule, coached by the owner, at the location the wizard created
  await owner.getByRole("button", { name: "Add to schedule" }).first().click();
  dialog = owner.getByRole("dialog");
  await dialog.locator("#session-repeat").selectOption("weekly");
  await dialog.locator("#session-class").selectOption({ label: "Strength" });
  await dialog.locator("#session-day").selectOption("wednesday");
  await dialog.locator("#session-time").fill("18:30");
  await dialog.locator("#session-coach").selectOption({ label: `${OWNER.first} ${OWNER.last}` });
  await expect(dialog.locator("#session-location")).toHaveValue(/^[0-9a-f-]{36}$/);
  await dialog.getByRole("button", { name: "Add to schedule" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(owner.getByText(/Weekly schedule added: \d+ sessions created/).first()).toBeVisible();
  await expect(sessionRows(owner).first()).toContainText("18:30");
  expect(await sessionRows(owner).count()).toBeGreaterThanOrEqual(11);
  // Every generated session is a Wednesday at 18:30 studio time.
  expect(sql("SELECT string_agg(DISTINCT to_char(starts_at AT TIME ZONE 'Europe/London', 'FMDay HH24:MI'), ',') FROM class_occurrences WHERE schedule_rule_id IS NOT NULL")).toBe("Wednesday 18:30");

  await owner.getByRole("tab", { name: /Weekly schedules/ }).click();
  await expect(owner.getByTestId("weekly-row")).toContainText("Wednesdays at 18:30");
  await expect(owner.getByTestId("weekly-row")).toContainText(`${OWNER.first} ${OWNER.last}`);

  // One-off session at a new location
  await owner.getByRole("tab", { name: /Sessions/ }).click();
  await owner.getByRole("button", { name: "Add to schedule" }).first().click();
  dialog = owner.getByRole("dialog");
  await dialog.locator("#session-date").fill(dateInZone(2, STUDIO.timezone));
  await dialog.locator("#session-time").fill("07:00");
  await dialog.locator("#session-location").selectOption("__new__");
  await dialog.locator("#session-new-location").fill("Outdoor area");
  await dialog.getByRole("button", { name: "Add to schedule" }).click();
  await expect(dialog).toHaveCount(0);
  const oneOff = sessionRows(owner).filter({ hasText: "Outdoor area" });
  await expect(oneOff).toContainText("07:00");
  await expect(oneOff).toContainText("0/8 booked");

  // Edit it
  await oneOff.getByRole("button", { name: "Edit session" }).click();
  dialog = owner.getByRole("dialog");
  await dialog.locator("#session-time").fill("07:30");
  await dialog.locator("#session-capacity").fill("6");
  await dialog.getByRole("button", { name: "Save session" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(oneOff).toContainText("07:30");
  await expect(oneOff).toContainText("0/6 booked");

  // Cancel it
  await oneOff.getByRole("button", { name: "Cancel session" }).click();
  dialog = owner.getByRole("dialog");
  await dialog.locator("#cancel-reason").fill("Coach unavailable");
  await dialog.getByRole("button", { name: "Cancel session" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(oneOff).toHaveCount(0);
  await expect(owner.getByRole("button", { name: "Show cancelled (1)" })).toBeVisible();
  expect(sql("SELECT cancellation_reason FROM class_occurrences WHERE is_cancelled")).toBe("Coach unavailable");
});

test("the owner sets a drop-in price, a class pack and a membership, and sees Stripe's status", async () => {
  await nav(owner, "Prices").click();
  await expect(owner.getByTestId("stripe-status")).toHaveAttribute("data-stripe-mode", "test");
  await expect(owner.getByTestId("stripe-status")).toContainText("Test mode");

  const dropIn = owner.getByTestId("dropin-row").filter({ hasText: "Strength" });
  await expect(dropIn).toContainText("£15 per session");
  await dropIn.getByRole("textbox").fill("16");
  await dropIn.getByRole("button", { name: "Save" }).click();
  await expect(dropIn).toContainText("£16 per session");

  await owner.getByRole("button", { name: "New class pack" }).click();
  let dialog = owner.getByRole("dialog");
  await dialog.locator("#pack-name").fill("5 sessions");
  await dialog.locator("#pack-count").fill("5");
  await dialog.locator("#pack-price").fill("60");
  await dialog.locator("#pack-days").fill("60");
  await dialog.getByRole("button", { name: "Save class pack" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(owner.getByTestId("pack-card")).toContainText("£60");
  await expect(owner.getByTestId("pack-card")).toContainText("5 sessions · valid 60 days");

  await owner.getByRole("button", { name: "New membership" }).click();
  dialog = owner.getByRole("dialog");
  await dialog.locator("#membership-name").fill("Unlimited");
  await dialog.locator("#membership-price").fill("90");
  await dialog.getByRole("button", { name: "Save membership" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(owner.getByTestId("membership-card")).toContainText("£90");
  await expect(owner.getByTestId("membership-card")).toContainText("Unlimited sessions");

  expect(sql("SELECT drop_in_price_cents FROM offerings")).toBe("1600");
  expect(sql("SELECT class_count || '|' || price_cents || '|' || validity_days FROM class_pack_types")).toBe("5|6000|60");
  expect(sql("SELECT billing_cycle || '|' || price_cents || '|' || COALESCE(classes_per_cycle::text, 'unlimited') FROM membership_types")).toBe("monthly|9000|unlimited");
});

test("an anonymous visitor sees the class, prices and schedule on the public booking page", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  watchConsole(page, "visitor");
  await page.goto(`/s/${STUDIO.slug}`);
  await expect(page.getByRole("heading", { name: STUDIO.name, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Strength" })).toBeVisible();
  await expect(page.getByText("£16 drop-in")).toBeVisible();
  await expect(page.getByText("5 sessions", { exact: true })).toBeVisible();
  await expect(page.getByText("£60")).toBeVisible();
  await expect(page.getByText("Unlimited", { exact: true })).toBeVisible();
  await expect(page.getByText("£90")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upcoming classes" })).toBeVisible();
  // The cancelled one-off session is not offered.
  await expect(page.getByText("Outdoor area")).toHaveCount(0);

  await page.goto(`/embed/schedule/${STUDIO.slug}`);
  await expect(page.getByText("Strength").first()).toBeVisible();
  await context.close();

  // And nothing beyond those public views: the tables themselves stay closed.
  const anon = anonClient();
  expect((await anon.from("offerings").select("id")).data ?? []).not.toHaveLength(0); // discoverable class types are public by design
  for (const table of ["class_occurrences", "bookings", "transactions", "studio_members", "profiles", "class_packs"]) {
    expect((await anon.from(table).select("*")).data ?? [], table).toHaveLength(0);
  }
});

test("a member's purchase arrives through the Stripe webhook; the owner books them in, marks attendance and sees the payment", async () => {
  const member = await signUp(MEMBER.email, MEMBER.first, MEMBER.last);
  expect(sql(`SELECT COUNT(*) FROM studio_members WHERE profile_id = '${member.id}'`)).toBe("1");

  const studioId = sql("SELECT id FROM studios");
  const packTypeId = sql("SELECT id FROM class_pack_types");
  const metadata = { type: "class_pack", class_pack_type_id: packTypeId, profile_id: member.id, studio_id: studioId };
  expect((await deliverCheckoutCompleted(metadata, 6000, { signature: "invalid" })).status).toBe(400);
  expect(sql("SELECT COUNT(*) FROM transactions")).toBe("0");
  const delivered = await deliverCheckoutCompleted(metadata, 6000);
  expect(delivered.status, delivered.text).toBe(200);
  expect(sql("SELECT type || '|' || status || '|' || amount_cents FROM transactions")).toBe("class_pack_purchase|completed|6000");

  // Find the member
  await nav(owner, "Members").click();
  await owner.getByRole("textbox", { name: "Search members" }).fill("mia");
  const row = owner.getByTestId("member-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`${MEMBER.first} ${MEMBER.last}`);
  await expect(row).toContainText("1 active pass");
  await row.click();

  // Their page: pass and payment
  await expect(owner.getByTestId("member-name")).toHaveText(`${MEMBER.first} ${MEMBER.last}`);
  await expect(owner.getByTestId("member-pack")).toContainText("5 of 5 sessions left");
  await expect(owner.getByTestId("member-payment")).toContainText("Class pack");
  await expect(owner.getByTestId("member-payment")).toContainText("£60");
  await expect(owner.getByTestId("member-payment")).toContainText("completed");

  // Book them into the next session; it comes off their pack
  const picker = owner.locator("#member-session");
  const firstSession = await picker.locator("option:not([disabled])").nth(1).getAttribute("value");
  await picker.selectOption(firstSession!);
  await owner.getByRole("button", { name: "Add booking" }).click();
  const booking = owner.getByTestId("member-booking");
  await expect(booking).toContainText("Strength");
  await expect(booking).toContainText("Booked");
  await expect(owner.getByTestId("member-pack")).toContainText("4 of 5 sessions left");

  // Roster: mark attendance
  await booking.getByRole("link", { name: "Roster" }).click();
  await expect(owner).toHaveURL(/\/manage\/sessions\/[0-9a-f-]{36}$/);
  const rosterRow = owner.getByTestId("roster-row");
  await expect(rosterRow).toContainText(`${MEMBER.first} ${MEMBER.last}`);
  await expect(rosterRow).toContainText("Class pack");
  await expect(owner.getByTestId("roster-summary")).toContainText("1/8 booked · 0 attended");
  await rosterRow.getByRole("button", { name: "Mark attended" }).click();
  await expect(rosterRow).toContainText("Attended");
  await expect(owner.getByTestId("roster-summary")).toContainText("1/8 booked · 1 attended");
  expect(sql(`SELECT b.status || '|' || (b.checked_in_by = (SELECT id FROM profiles WHERE email = '${OWNER.email}')) || '|' || co.booked_count || '|' || co.checked_in_count FROM bookings b JOIN class_occurrences co ON co.id = b.class_occurrence_id`)).toBe("checked_in|true|1|1");
  expect(sql("SELECT classes_remaining FROM class_packs")).toBe("4");

  // Payments
  await nav(owner, "Payments").click();
  const payment = owner.getByTestId("payment-row");
  await expect(payment).toHaveCount(1);
  await expect(payment).toContainText("Class pack");
  await expect(payment).toContainText(`${MEMBER.first} ${MEMBER.last}`);
  await expect(payment).toContainText("£60");
  await expect(payment).toContainText("completed");
  await expect(owner.getByTestId("payments-total")).toHaveText("£60");

  // Dashboard numbers follow
  await nav(owner, "Dashboard").click();
  await expect(owner.getByTestId("stat-members")).toHaveText("2");
  await expect(owner.getByText(`${MEMBER.first} ${MEMBER.last}`)).toBeVisible();
  expect(Number(await owner.getByTestId("stat-upcoming").textContent())).toBeGreaterThanOrEqual(1);

  // The member, signed in as themselves, sees their own pass and nobody else's data.
  expect((await member.client.from("class_packs").select("classes_remaining")).data).toEqual([{ classes_remaining: 4 }]);
  expect((await member.client.from("transactions").select("amount_cents")).data).toEqual([{ amount_cents: 6000 }]);
  expect((await member.client.rpc("manage_list_members", { p_studio_id: studioId })).error).not.toBeNull();
});

test("with the studio in place, other accounts cannot reach /manage or the studio's data", async ({ browser }) => {
  // The earlier account, still signed in.
  for (const path of ["/manage/onboarding", "/manage", "/manage/schedule", "/manage/offerings", "/manage/students", "/manage/financials"]) {
    await expectTurnedAway(intruder, path);
  }

  // A brand-new account, registered after the studio exists.
  const context = await browser.newContext();
  const page = await context.newPage();
  await register(page, LATE);
  await expectTurnedAway(page, "/manage/onboarding");
  await expectTurnedAway(page, "/manage");
  await context.close();

  const studioId = sql("SELECT id FROM studios");
  const offeringId = sql("SELECT id FROM offerings");
  const occurrenceId = sql("SELECT class_occurrence_id FROM bookings");
  const bookingId = sql("SELECT id FROM bookings");
  const memberId = sql(`SELECT id FROM profiles WHERE email = '${MEMBER.email}'`);

  for (const email of [INTRUDER.email, LATE.email]) {
    const api = await signIn(email);
    expect((await api.client.rpc("get_my_effective_role")).data, email).toBe("student");
    expect((await api.client.rpc("studio_setup_access")).data, email).toMatchObject({ studio_exists: true, can_create_studio: false, can_open_setup: false });
    expect((await callFunction(api, "onboarding", { step: "status" })).status, email).toBe(403);
    expect((await callFunction(api, "onboarding", { step: "studio", data: { studioName: "Second Studio" } })).status, email).toBe(403);
    expect((await callFunction(api, "onboarding", { step: "launch", data: { discoverable: false } })).status, email).toBe(403);

    // Reads: no member list, payments, bookings, or other people's profiles.
    expect((await api.client.rpc("manage_my_studio")).data, email).toBeNull();
    expect((await api.client.rpc("manage_dashboard", { p_studio_id: studioId })).error, email).not.toBeNull();
    expect((await api.client.rpc("manage_list_members", { p_studio_id: studioId })).error, email).not.toBeNull();
    expect((await api.client.from("transactions").select("id")).data ?? [], email).toHaveLength(0);
    expect((await api.client.from("bookings").select("id")).data ?? [], email).toHaveLength(0);
    expect((await api.client.from("profiles").select("id").neq("id", api.id)).data ?? [], email).toHaveLength(0);

    // Writes: nothing a manager can do.
    expect((await api.client.from("offerings").insert({ studio_id: studioId, name: "Rogue", slug: "rogue" })).error, email).not.toBeNull();
    expect((await api.client.from("offerings").update({ drop_in_price_cents: 1 }).eq("id", offeringId).select()).data ?? [], email).toHaveLength(0);
    expect((await api.client.from("class_pack_types").update({ price_cents: 1 }).eq("studio_id", studioId).select()).data ?? [], email).toHaveLength(0);
    expect((await api.client.from("studios").update({ discoverable: false }).eq("id", studioId).select()).data ?? [], email).toHaveLength(0);
    expect((await api.client.from("studio_staff").insert({ studio_id: studioId, profile_id: api.id, role: "owner" })).error, email).not.toBeNull();
    expect((await api.client.rpc("manage_create_session", { p_offering_id: offeringId, p_location_id: studioId, p_teacher_id: null, p_date: dateInZone(3, STUDIO.timezone), p_start_time: "10:00" })).error, email).not.toBeNull();
    expect((await api.client.rpc("manage_cancel_session", { p_occurrence_id: occurrenceId })).error, email).not.toBeNull();
    expect((await api.client.rpc("staff_book_member", { p_occurrence_id: occurrenceId, p_profile_id: api.id })).error, email).not.toBeNull();
    expect((await api.client.rpc("staff_set_attendance", { p_booking_id: bookingId, p_status: "no_show" })).error, email).not.toBeNull();
    expect((await api.client.rpc("cancel_booking", { p_booking_id: bookingId })).error, email).not.toBeNull();
  }

  // Nothing above changed anything.
  expect(sql("SELECT COUNT(*) FROM studios")).toBe("1");
  expect(sql("SELECT COUNT(*) FROM studio_staff")).toBe("1");
  expect(sql("SELECT drop_in_price_cents FROM offerings")).toBe("1600");
  expect(sql("SELECT status FROM bookings")).toBe("checked_in");
  // A non-allow-listed account cannot be made an owner even with database-owner rights.
  expect(sqlFails(`INSERT INTO studio_staff (studio_id, profile_id, role) SELECT '${studioId}', id, 'owner' FROM profiles WHERE email = '${INTRUDER.email}';`)).toBe(true);
  expect(sqlFails(`INSERT INTO studios (name, slug) VALUES ('Second Studio', 'second-studio');`)).toBe(true);
  expect(memberId).toMatch(/^[0-9a-f-]{36}$/);
});

test("the owner screens fit a phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  watchConsole(page, "phone");
  await page.goto("/auth/login");
  await page.locator("#email").fill(OWNER.email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/manage$/);
  await expect(page.getByTestId("stat-members")).toBeVisible();

  const memberId = sql(`SELECT id FROM profiles WHERE email = '${MEMBER.email}'`);
  const occurrenceId = sql("SELECT class_occurrence_id FROM bookings");
  const screens: [string, string][] = [
    ["/manage", "Dashboard"],
    ["/manage/schedule", "Classes"],
    [`/manage/sessions/${occurrenceId}`, "Session"],
    ["/manage/offerings", "Prices"],
    ["/manage/students", "Members"],
    [`/manage/members/${memberId}`, "Member"],
    ["/manage/financials", "Payments"],
  ];
  for (const [path, heading] of screens) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
  }

  // The menu button opens the navigation.
  await page.goto("/manage");
  await page.locator("header button").first().click();
  await nav(page, "Classes").click();
  await expect(page).toHaveURL(/\/manage\/schedule$/);
  await page.getByRole("button", { name: "Add to schedule" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const dialogBox = await page.getByRole("dialog").boundingBox();
  expect(dialogBox!.width).toBeLessThanOrEqual(390);
  await context.close();
});

test("no console errors on the owner, visitor or phone pages", async () => {
  expect(consoleErrors).toEqual([]);
});
