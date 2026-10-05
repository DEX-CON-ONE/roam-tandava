/**
 * Stripe Webhook Handler (Supabase Edge Function)
 *
 * Handles Stripe events for:
 *   - checkout.session.completed  — finalize bookings and memberships
 *   - customer.subscription.*     — sync subscription status
 *   - invoice.payment_failed      — mark membership as past_due
 *
 * Deploy: supabase functions deploy stripe-webhook
 * Set secrets:
 *   supabase secrets set STRIPE_SECRET_KEY=sk_...
 *   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
 *
 * Configure webhook endpoint in Stripe Dashboard:
 *   URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
 *   Events: checkout.session.completed, customer.subscription.updated,
 *           customer.subscription.deleted, invoice.payment_failed
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { assertStripeKeyMode, stripeStatusToMembershipStatus } from "../stripe/config.ts";
import { createStripeWebhookHandler as createRequestHandler } from "./handler.ts";

const stripe = new Stripe(assertStripeKeyMode(
  Deno.env.get("STRIPE_SECRET_KEY"),
  Deno.env.get("ALLOW_LIVE_STRIPE") === "true",
), {
  apiVersion: "2024-06-20",
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service role client bypasses RLS for webhook-driven writes
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export function createStripeWebhookHandler(
  dependencies: { stripe?: Stripe; webhookSecret?: string; supabase?: typeof supabase } = {},
) {
  const stripeClient = dependencies.stripe ?? stripe;
  const secret = dependencies.webhookSecret ?? webhookSecret;
  const database = dependencies.supabase ?? supabase;
  return createRequestHandler({
    stripe: stripeClient,
    webhookSecret: secret,
    supabase: database,
    onEvent: async (event, database) => {
      console.log(`[stripe-webhook] Received: ${event.type}`);
      switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, database);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, database);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, database);
        break;

      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice, database);
        break;

      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice, database);
        break;
      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
      }
    },
  });
}

serve(createStripeWebhookHandler());

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, database = supabase) {
  const metadata = session.metadata || {};
  const paymentIntentId = (session.payment_intent as string) || null;

  switch (metadata.type) {
    case "drop_in": {
      // Record the financial settlement, then the operational booking.
      const { data: txn, error: txnError } = await database
        .from("transactions")
        .insert({
          studio_id: metadata.studio_id,
          profile_id: metadata.profile_id,
          type: "drop_in",
          status: "completed",
          amount_cents: session.amount_total,
          stripe_payment_intent_id: paymentIntentId,
        })
        .select("id")
        .single();
      if (txnError && txnError.code !== "23505") {
        console.error("Failed to record drop-in transaction:", txnError);
        return;
      }

      const transaction = txn ?? (await database
        .from("transactions")
        .select("id")
        .eq("stripe_payment_intent_id", paymentIntentId)
        .single()).data;
      if (!transaction) return;

      const { error: bookingError } = await database.from("bookings").insert({
        studio_id: metadata.studio_id,
        class_occurrence_id: metadata.occurrence_id,
        profile_id: metadata.profile_id,
        status: "confirmed",
        transaction_id: transaction.id,
      });
      if (bookingError && bookingError.code !== "23505") console.error("Failed to create booking:", bookingError);
      break;
    }

    case "membership": {
      // Resolve the plan to compute the initial billing period.
      const { data: mt } = await database
        .from("membership_types")
        .select("billing_cycle, price_cents")
        .eq("id", metadata.membership_type_id)
        .single();

      const now = new Date();
      const end = new Date(now);
      switch (mt?.billing_cycle) {
        case "weekly": end.setDate(end.getDate() + 7); break;
        case "quarterly": end.setMonth(end.getMonth() + 3); break;
        case "annual": end.setFullYear(end.getFullYear() + 1); break;
        default: end.setMonth(end.getMonth() + 1);
      }

      const { data: membership, error: memErr } = await database
        .from("memberships")
        .insert({
          studio_id: metadata.studio_id,
          profile_id: metadata.profile_id,
          membership_type_id: metadata.membership_type_id,
          status: "active",
          current_period_start: now.toISOString(),
          current_period_end: end.toISOString(),
          stripe_subscription_id: session.subscription as string,
        })
        .select("id")
        .single();
      if (memErr && memErr.code !== "23505") {
        console.error("Failed to create membership:", memErr);
        return;
      }

      const resolvedMembership = membership ?? (await database
        .from("memberships")
        .select("id")
        .eq("stripe_subscription_id", session.subscription as string)
        .single()).data;
      if (!resolvedMembership) return;

      const { error: txnError } = await database.from("transactions").insert({
        studio_id: metadata.studio_id,
        profile_id: metadata.profile_id,
        type: "membership_purchase",
        status: "completed",
        amount_cents: session.amount_total ?? mt?.price_cents ?? 0,
        stripe_payment_intent_id: paymentIntentId,
        membership_id: resolvedMembership.id,
      });
      if (txnError) console.error("Failed to record membership transaction:", txnError);
      break;
    }

    case "workshop": {
      const balanceDue = parseInt(metadata.balance_due_cents || "0", 10);
      const paid = session.amount_total ?? 0;

      const { data: txn } = await database
        .from("transactions")
        .insert({
          studio_id: metadata.studio_id,
          profile_id: metadata.profile_id,
          type: "workshop",
          status: "completed",
          amount_cents: paid,
          stripe_payment_intent_id: paymentIntentId,
        })
        .select("id")
        .single();

      const { error: regErr } = await database.from("event_registrations").insert({
        event_id: metadata.event_id,
        studio_id: metadata.studio_id,
        profile_id: metadata.profile_id,
        pricing_tier_id: metadata.tier_id || null,
        status: "registered",
        amount_paid_cents: paid,
        deposit_paid_cents: balanceDue > 0 ? paid : 0,
        balance_due_cents: balanceDue,
        transaction_id: txn?.id ?? null,
      });
      if (regErr) {
        console.error("Failed to create event registration:", regErr);
        break;
      }

      // Bump denormalized registration counts (no trigger for events).
      await database.rpc("increment_event_registered", { p_event_id: metadata.event_id });
      if (metadata.tier_id) {
        await database.rpc("increment_tier_registered", { p_tier_id: metadata.tier_id });
      }
      break;
    }

    case "class_pack": {
      const { data: pt } = await database
        .from("class_pack_types")
        .select("class_count, validity_days, price_cents")
        .eq("id", metadata.class_pack_type_id)
        .single();
      if (!pt) {
        console.error("Class pack type not found:", metadata.class_pack_type_id);
        return;
      }

      const expires = new Date();
      expires.setDate(expires.getDate() + (pt.validity_days ?? 90));

      const { data: pack, error: packErr } = await database
        .from("class_packs")
        .insert({
          studio_id: metadata.studio_id,
          profile_id: metadata.profile_id,
          class_pack_type_id: metadata.class_pack_type_id,
          status: "active",
          classes_remaining: pt.class_count,
          classes_total: pt.class_count,
          expires_at: expires.toISOString(),
          stripe_payment_intent_id: paymentIntentId,
        })
        .select("id")
        .single();
      if (packErr && packErr.code !== "23505") {
        console.error("Failed to create class pack:", packErr);
        return;
      }

      const resolvedPack = pack ?? (await database
        .from("class_packs")
        .select("id")
        .eq("stripe_payment_intent_id", paymentIntentId)
        .single()).data;
      if (!resolvedPack) return;

      const { error: txnError } = await database.from("transactions").insert({
        studio_id: metadata.studio_id,
        profile_id: metadata.profile_id,
        type: "class_pack_purchase",
        status: "completed",
        amount_cents: session.amount_total ?? pt.price_cents ?? 0,
        stripe_payment_intent_id: paymentIntentId,
        class_pack_id: resolvedPack.id,
      });
      if (txnError) console.error("Failed to record class pack transaction:", txnError);
      break;
    }
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription, database = supabase) {
  // Map Stripe subscription status → membership_status enum
  // (active, paused, cancelled, expired, past_due).
  const { error } = await database
    .from("memberships")
    .update({
      status: stripeStatusToMembershipStatus(subscription.status),
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) console.error("Failed to update subscription:", error);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, database = supabase) {
  const { error } = await database
    .from("memberships")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id);

  if (error) console.error("Failed to cancel subscription:", error);
}

async function handlePaymentFailed(invoice: Stripe.Invoice, database = supabase) {
  if (!invoice.subscription) return;

  const { error } = await database
    .from("memberships")
    .update({ status: "past_due" })
    .eq("stripe_subscription_id", invoice.subscription as string);

  if (error) console.error("Failed to mark membership as past_due:", error);
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice, database = supabase) {
  if (!invoice.subscription) return;
  const { error } = await database
    .from("memberships")
    .update({ status: "active" })
    .eq("stripe_subscription_id", invoice.subscription as string)
    .eq("status", "past_due");
  if (error) console.error("Failed to restore membership after payment:", error);
}
