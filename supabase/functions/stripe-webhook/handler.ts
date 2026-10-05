import type Stripe from "stripe";

export type StripeDatabase = {
  from: (table: string) => {
    insert: (values: unknown) => { select: (columns: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }>; single: () => Promise<{ data: unknown; error: unknown }> } };
    update: (values: unknown) => { eq: (column: string, value: unknown) => { eq: (column: string, value: unknown) => Promise<{ error: unknown }> } };
  };
};

export function createStripeWebhookHandler({
  stripe,
  webhookSecret,
  supabase,
  onEvent,
}: {
  stripe: Pick<Stripe, "webhooks">;
  webhookSecret: string;
  supabase: StripeDatabase;
  onEvent: (event: Stripe.Event, supabase: StripeDatabase) => Promise<void>;
}) {
  return async (req: Request) => {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return new Response("Missing stripe-signature header", { status: 400 });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(await req.text(), signature, webhookSecret) as Stripe.Event;
    } catch (error) {
      console.error("Webhook signature verification failed:", error);
      return new Response("Invalid signature", { status: 400 });
    }

    try {
      const { data: claimed, error } = await (supabase.from("stripe_webhook_events") as { insert: (v: unknown) => { select: (c: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> } } })
        .insert({ id: event.id, type: event.type }).select("id").maybeSingle();
      if (error) throw error;
      if (!claimed) return Response.json({ received: true, duplicate: true });

      await onEvent(event, supabase);
      const { error: completeError } = await (supabase.from("stripe_webhook_events") as unknown as { update: (v: unknown) => { eq: (c: string, value: unknown) => Promise<{ error: unknown }> } })
        .update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", event.id);
      if (completeError) throw completeError;
    } catch (error) {
      console.error(`[stripe-webhook] Error handling ${event.type}:`, error);
      return Response.json({ received: false }, { status: 500 });
    }
    return Response.json({ received: true });
  };
}
