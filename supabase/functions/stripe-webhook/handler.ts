export type StripeEvent = {
  id: string;
  type: string;
  data: { object: unknown };
};

export type StripeWebhookClient = {
  webhooks: {
    constructEventAsync: (payload: string, signature: string, secret: string) => Promise<StripeEvent> | StripeEvent;
  };
};

export type StripeDatabase = {
  from: (table: string) => {
    insert: (values: unknown) => { select: (columns: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }>; single: () => Promise<{ data: unknown; error: unknown }> } };
    select?: (columns: string) => { eq: (column: string, value: unknown) => { single: () => Promise<{ data: unknown; error: unknown }> } };
    update: (values: unknown) => { eq: (column: string, value: unknown) => { eq: (column: string, value: unknown) => Promise<{ error: unknown }> } };
  };
};

type StripeWebhookEventRow = { id: string; status: "processing" | "processed" };

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function createStripeWebhookHandler({
  stripe,
  webhookSecret,
  supabase,
  onEvent,
  onProcessed,
}: {
  stripe: StripeWebhookClient;
  webhookSecret: string;
  supabase: StripeDatabase;
  onEvent: (event: StripeEvent, supabase: StripeDatabase) => Promise<void>;
  /**
   * Runs at most once per Stripe event id, after the event was processed and
   * only for the delivery that moved the ledger row from `processing` to
   * `processed`. Use it for side effects that must not repeat on replays or
   * concurrent duplicate deliveries (e.g. confirmation emails). Errors are
   * logged and never fail the webhook.
   */
  onProcessed?: (event: StripeEvent, supabase: StripeDatabase) => Promise<void>;
}) {
  return async (req: Request) => {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return new Response("Missing stripe-signature header", { status: 400 });

    let event: StripeEvent;
    try {
      event = await stripe.webhooks.constructEventAsync(await req.text(), signature, webhookSecret);
    } catch (error) {
      console.error("Webhook signature verification failed:", error);
      return new Response("Invalid signature", { status: 400 });
    }

    let completedByThisDelivery = false;
    try {
      const { data: claimed, error } = await (supabase.from("stripe_webhook_events") as { insert: (v: unknown) => { select: (c: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> } } })
        .insert({ id: event.id, type: event.type }).select("id").maybeSingle();
      if (error && !isDuplicateKeyError(error)) throw error;
      if (error && isDuplicateKeyError(error)) {
        const { data: existing, error: readError } = await (supabase.from("stripe_webhook_events") as { select: (c: string) => { eq: (column: string, value: unknown) => { single: () => Promise<{ data: StripeWebhookEventRow | null; error: unknown }> } } })
          .select("id, status").eq("id", event.id).single();
        if (readError) throw readError;
        if (existing?.status === "processed") return Response.json({ received: true, duplicate: true });
      }
      if (!claimed && !error) return Response.json({ received: true, duplicate: true });

      await onEvent(event, supabase);
      // Conditional on `processing` so exactly one delivery wins the transition.
      const { data: completed, error: completeError } = await (supabase.from("stripe_webhook_events") as unknown as { update: (v: unknown) => { eq: (c: string, value: unknown) => { eq: (c: string, value: unknown) => { select: (columns: string) => Promise<{ data: unknown[] | null; error: unknown }> } } } })
        .update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", event.id).eq("status", "processing").select("id");
      if (completeError) throw completeError;
      completedByThisDelivery = Array.isArray(completed) && completed.length > 0;
    } catch (error) {
      console.error(`[stripe-webhook] Error handling ${event.type}:`, error);
      return Response.json({ received: false }, { status: 500 });
    }
    if (completedByThisDelivery && onProcessed) {
      try {
        await onProcessed(event, supabase);
      } catch (error) {
        console.error(`[stripe-webhook] Post-processing failed for ${event.type} (ignored):`, error);
      }
    }
    return Response.json({ received: true });
  };
}
