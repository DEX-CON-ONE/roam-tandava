-- Stripe webhook delivery ledger. Stripe retries are expected; each event ID
-- must be claimed once before any entitlement or financial write occurs.
CREATE TABLE stripe_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_stripe_webhook_events_received_at
  ON stripe_webhook_events(received_at);

CREATE UNIQUE INDEX idx_class_packs_stripe_payment_intent
  ON class_packs(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX idx_memberships_stripe_subscription
  ON memberships(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX idx_transactions_stripe_payment_intent
  ON transactions(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only for Stripe webhook events"
  ON stripe_webhook_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE stripe_webhook_events IS
  'Idempotency ledger for verified Stripe webhook event IDs; service role only.';
