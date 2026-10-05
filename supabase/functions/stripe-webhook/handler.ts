export type StripeEvent = {
  id: string;
  type: string;
  data: { object: unknown };
};

export type StripeWebhookClient = {
  webhooks: {
    constructEvent: (payload: string, signature: string, secret: string) => StripeEvent;
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
}: {
  stripe: StripeWebhookClient;
  webhookSecret: string;
  supabase: StripeDatabase;
  onEvent: (event: StripeEvent, supabase: StripeDatabase) => Promise<void>;
}) {
  return async (req: Request) => {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return new Response("Missing stripe-signature header", { status: 400 });

    let event: StripeEvent;
    try {
      event = stripe.webhooks.constructEvent(await req.text(), signature, webhookSecret);
    } catch (error) {
      console.error("Webhook signature verification failed:", error);
      return new Response("Invalid signature", { status: 400 });
    }

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
