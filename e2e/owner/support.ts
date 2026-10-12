/**
 * Shared helpers for the owner end-to-end tests.
 *
 * The tests run against the isolated local Supabase stack started by
 * scripts/e2e-stack.sh. Test users are real Auth users with real sessions;
 * nothing here uses the service-role key. The database is only touched
 * directly (through psql in the stack's own container) to put the stack into
 * a known starting state and to read values back for assertions.
 */

import { execFileSync, execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "roam-tandava-e2e";
export const STACK_DIR = process.env.E2E_STACK_DIR ?? join(homedir(), ".cache", "roam-tandava-e2e-stack");
export const APP_URL = process.env.E2E_APP_URL ?? "http://127.0.0.1:4173";
/** Matches STRIPE_WEBHOOK_SECRET written by scripts/e2e-stack.sh. Local only. */
export const WEBHOOK_SECRET = "whsec_local_e2e_only";
export const PASSWORD = "e2e-Passw0rd-local";

export interface StackEnv {
  API_URL: string;
  ANON_KEY: string;
}

let cached: StackEnv | null = null;

export function stackEnv(): StackEnv {
  if (cached) return cached;
  const supabase = process.env.SUPABASE_BIN ?? "supabase";
  const out = execSync(`${supabase} status -o env`, { cwd: STACK_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const values: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) values[line.slice(0, at)] = line.slice(at + 1).replace(/^"|"$/g, "");
  }
  if (!values.API_URL || !values.ANON_KEY) {
    throw new Error(`The local Supabase stack is not running in ${STACK_DIR}. Start it with scripts/e2e-stack.sh up`);
  }
  cached = { API_URL: values.API_URL, ANON_KEY: values.ANON_KEY };
  return cached;
}

/** Runs SQL as the database owner inside the stack's database container. */
export function sql(query: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", `supabase_db_${PROJECT_ID}`, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

export function sqlFails(query: string): boolean {
  try {
    sql(query);
    return false;
  } catch {
    return true;
  }
}

export function anonClient(): SupabaseClient {
  const env = stackEnv();
  return createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface ApiUser {
  client: SupabaseClient;
  id: string;
  token: string;
}

/** Signs in through the Auth API and returns a client that carries the user's session. */
export async function signIn(email: string): Promise<ApiUser> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return { client, id: data.user.id, token: data.session.access_token };
}

/** Registers through the Auth API (the same call the register page makes). */
export async function signUp(email: string, firstName: string, lastName: string): Promise<ApiUser> {
  const client = anonClient();
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD, options: { data: { first_name: firstName, last_name: lastName } } });
  if (error || !data.session || !data.user) throw new Error(`sign-up failed for ${email}: ${error?.message}`);
  return { client, id: data.user.id, token: data.session.access_token };
}

/** Calls an Edge Function as a signed-in user. */
export async function callFunction(user: ApiUser, name: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const env = stackEnv();
  const response = await fetch(`${env.API_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

/**
 * Delivers a `checkout.session.completed` event to the local stripe-webhook
 * function, signed the way Stripe signs it (HMAC-SHA256 over `timestamp.payload`
 * with the endpoint's signing secret). The function verifies the signature and
 * records the purchase exactly as it does for a real Stripe delivery.
 */
export async function deliverCheckoutCompleted(
  metadata: Record<string, string>,
  amountTotal: number,
  options: { signature?: "valid" | "invalid" } = {},
): Promise<{ status: number; text: string }> {
  const env = stackEnv();
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify({
    id: `evt_e2e_${unique}`,
    object: "event",
    type: "checkout.session.completed",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: `cs_test_e2e_${unique}`,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        amount_total: amountTotal,
        currency: "gbp",
        payment_intent: `pi_e2e_${unique}`,
        metadata,
      },
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest("hex");
  const signature = options.signature === "invalid" ? "0".repeat(64) : digest;
  const response = await fetch(`${env.API_URL}/functions/v1/stripe-webhook`, {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}`, "Content-Type": "application/json" },
    body: payload,
  });
  return { status: response.status, text: await response.text() };
}

/** YYYY-MM-DD for a day `offset` days from today, in the given timezone. */
export function dateInZone(offset: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86_400_000));
  return parts;
}
