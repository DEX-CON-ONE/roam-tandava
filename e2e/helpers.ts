import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see e2e/README.md)`);
  return value;
}

export const env = {
  supabaseUrl: required("E2E_SUPABASE_URL"),
  anonKey: required("E2E_ANON_KEY"),
  serviceKey: required("E2E_SERVICE_ROLE_KEY"),
  stripeKey: required("STRIPE_SECRET_KEY"),
  webhookSecret: required("E2E_WEBHOOK_SECRET"),
  slug: process.env.E2E_STUDIO_SLUG ?? "roam-athletic-club",
};

if (!env.stripeKey.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY must be a Stripe TEST key");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.supabaseUrl)) throw new Error("E2E tests only run against a LOCAL Supabase stack");

/** Service-role REST access to the LOCAL database: fixtures and assertions only. */
export async function db<T = unknown>(method: string, path: string, body?: unknown, prefer = "return=representation"): Promise<T> {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function waitFor<T>(what: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function stripeGet<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${env.stripeKey}` } });
  if (!response.ok) throw new Error(`stripe ${path} -> ${response.status}`);
  return (await response.json()) as T;
}

type StripeEvent = { id: string; type: string; created: number; livemode: boolean; data: { object: { metadata?: Record<string, string>; payment_status?: string } } };

/**
 * Stand-in for `stripe listen --forward-to`: takes the REAL checkout.session.completed
 * event Stripe produced for this member and delivers it to the local stripe-webhook
 * function, signed with the local endpoint secret. Returns the event and the function's reply.
 */
export async function forwardCheckoutWebhook(profileId: string, sinceEpoch: number) {
  const event = await waitFor("Stripe checkout.session.completed event", async () => {
    const list = await stripeGet<{ data: StripeEvent[] }>(`events?type=checkout.session.completed&limit=30&created[gte]=${sinceEpoch - 5}`);
    return list.data.find((candidate) => candidate.data.object.metadata?.profile_id === profileId);
  }, 90_000);
  expect(event.livemode).toBe(false);
  const deliver = async () => {
    const payload = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", env.webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
    const response = await fetch(`${env.supabaseUrl}/functions/v1/stripe-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${timestamp},v1=${signature}`, Authorization: `Bearer ${env.anonKey}`, apikey: env.anonKey },
      body: payload,
    });
    return { status: response.status, body: await response.text() };
  };
  return { event, first: await deliver(), deliver };
}

/** Pay on Stripe's hosted Checkout page with the published test card. */
export async function payWithTestCard(page: Page, email: string) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  const emailField = page.locator("input#email");
  await emailField.waitFor({ timeout: 60_000 });
  if (await emailField.isEditable()) await emailField.fill(email);
  // Card may be behind a payment-method accordion.
  const cardNumber = page.locator("input#cardNumber");
  if (!(await cardNumber.isVisible().catch(() => false))) {
    const cardTab = page.locator('[data-testid="card-accordion-item"], [data-testid="card-accordion-item-button"], #payment-method-accordion-item-title-card').first();
    if (await cardTab.isVisible().catch(() => false)) await cardTab.click({ force: true });
  }
  await cardNumber.waitFor({ timeout: 30_000 });
  await cardNumber.fill("4242 4242 4242 4242");
  await page.locator("input#cardExpiry").fill("12 / 34");
  await page.locator("input#cardCvc").fill("123");
  const name = page.locator("input#billingName");
  if (await name.isVisible().catch(() => false)) await name.fill("E2E Member");
  const country = page.locator("select#billingCountry");
  if (await country.isVisible().catch(() => false)) await country.selectOption("GB");
  const postal = page.locator("input#billingPostalCode");
  if (await postal.isVisible().catch(() => false)) await postal.fill("GU9 7AA");
  // Do not save details with Link.
  const link = page.locator("input#enableStripePass");
  if (await link.isVisible().catch(() => false) && await link.isChecked().catch(() => false)) await link.uncheck({ force: true });
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();
}

/** Register through the real form, arriving from a booking link (`?next=`). */
export async function registerFromBookingLink(page: Page, member: { firstName: string; lastName: string; email: string; password: string }) {
  await page.getByRole("link", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/auth\/register\?next=/);
  await page.locator("#firstName").fill(member.firstName);
  await page.locator("#lastName").fill(member.lastName);
  await page.locator("#email").fill(member.email);
  await page.locator("#password").fill(member.password);
  await page.locator("#terms").click();
  await page.locator('button[type="submit"]').click();
  await page.getByRole("button", { name: "Continue to booking" }).click();
}

export function newMember(tag: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return { firstName: "E2E", lastName: `Member ${tag}`, email: `e2e-${tag}-${stamp}@example.com`, password: `Pw-${stamp}-x9` };
}

export async function profileIdFor(email: string): Promise<string> {
  const rows = await waitFor("profile row", async () => {
    const found = await db<Array<{ id: string }>>("GET", `profiles?select=id&email=eq.${encodeURIComponent(email)}`);
    return found.length ? found : null;
  });
  return rows[0].id;
}
