/**
 * Stripe Connect for a studio (Supabase Edge Function)
 *
 * Lets a studio's owner link the studio to its own Stripe account, so that
 * card payments are paid out to that account (stripe-checkout then creates
 * destination charges to it). Until an account is connected and able to take
 * payments, checkout charges the deployment's own Stripe account.
 *
 * Actions (POST body { action }), owner only:
 *   "status"     — what the owner screen needs: is Stripe configured here, test
 *                  or live, is Connect switched on for the platform account, is
 *                  an account linked, can it take payments. Re-reads the account
 *                  from Stripe and stores stripe_onboarding_complete.
 *   "start"      — create (or reuse) the studio's Stripe account and return a
 *                  link to Stripe's hosted onboarding. Also resumes an
 *                  unfinished onboarding.
 *   "disconnect" — unlink the account from the studio. The Stripe account
 *                  itself is not closed; payments go back to the deployment's
 *                  account.
 *
 * Every answer is 200 with { ok, ... } so the screen can show Stripe's own
 * explanation; only authentication and permission failures use 401/403.
 *
 * Deploy: supabase functions deploy stripe-connect
 * Secrets: STRIPE_SECRET_KEY, APP_URL (ALLOW_LIVE_STRIPE=true only for live keys)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { connectStatusFromAccount, describeStripeError, stripeKeyMode } from "../stripe/config.ts";

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const allowLive = Deno.env.get("ALLOW_LIVE_STRIPE") === "true";
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const appUrl = (Deno.env.get("APP_URL") ?? "http://localhost:8080").replace(/\/+$/, "");
/** Where Stripe sends the owner back to. */
const returnPath = "/manage/offerings";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Not authenticated" }, 401);

  let payload: { action?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const action = String(payload.action ?? "status");

  const db = createClient(supabaseUrl, serviceKey);

  // Only the studio's owner can manage its Stripe connection.
  const { data: ownerRow } = await db
    .from("studio_staff")
    .select("studio_id")
    .eq("profile_id", user.id)
    .eq("role", "owner")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!ownerRow) return json({ error: "Only the studio owner can manage payments" }, 403);
  const studioId = ownerRow.studio_id as string;

  const { data: studio, error: studioErr } = await db
    .from("studios")
    .select("id, name, email, stripe_account_id, stripe_onboarding_complete")
    .eq("id", studioId)
    .single();
  if (studioErr || !studio) return json({ ok: false, error: "Studio not found" });

  const mode = stripeKeyMode(stripeKey);
  const base = { ok: true, mode, accountLinked: Boolean(studio.stripe_account_id), connected: false, chargesEnabled: false, detailsSubmitted: false };

  // Nothing can be done without a usable key; say so instead of failing.
  if (mode === "missing") return json({ ...base, ok: action === "status", problem: "not_configured", message: "Card payments are not set up on this site yet." });
  if (mode === "live" && !allowLive) return json({ ...base, ok: action === "status", problem: "live_not_allowed", message: "This site holds a live Stripe key but live payments have not been switched on." });

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

  try {
    if (action === "status") {
      if (!studio.stripe_account_id) return json(base);
      const account = await stripe.accounts.retrieve(studio.stripe_account_id as string);
      const status = connectStatusFromAccount(account);
      if (status.connected !== Boolean(studio.stripe_onboarding_complete)) {
        await db.from("studios").update({ stripe_onboarding_complete: status.connected }).eq("id", studioId);
        if (status.connected) {
          const { data: onboarding } = await db.from("studio_onboarding").select("id, completed_steps").eq("studio_id", studioId).maybeSingle();
          if (onboarding) {
            const steps = new Set<string>(onboarding.completed_steps ?? []);
            steps.add("stripe");
            await db.from("studio_onboarding").update({ completed_steps: [...steps], has_stripe: true }).eq("id", onboarding.id);
          }
        }
      }
      return json({ ...base, ...status });
    }

    if (action === "start") {
      let accountId = studio.stripe_account_id as string | null;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "standard",
          email: studio.email ?? user.email ?? undefined,
          business_profile: { name: studio.name },
          metadata: { studio_id: studioId },
        });
        accountId = account.id;
        await db.from("studios").update({ stripe_account_id: accountId, stripe_onboarding_complete: false }).eq("id", studioId);
      }
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${appUrl}${returnPath}?stripe=refresh`,
        return_url: `${appUrl}${returnPath}?stripe=return`,
        type: "account_onboarding",
      });
      return json({ ...base, accountLinked: true, url: link.url });
    }

    if (action === "disconnect") {
      await db.from("studios").update({ stripe_account_id: null, stripe_onboarding_complete: false }).eq("id", studioId);
      return json({ ...base, accountLinked: false });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    const described = describeStripeError(err);
    console.error(`[stripe-connect] ${action} failed: ${described.problem}`);
    return json({ ...base, ok: false, ...described });
  }
});
