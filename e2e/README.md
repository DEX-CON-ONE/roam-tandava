# End-to-end tests: member booking

`member-booking.spec.ts` drives the real customer journey in a phone-sized browser:

1. storefront, schedule, class (signed out), register through the form, land back on the class
2. buy a class pass in Stripe's hosted Checkout with the published test card `4242 4242 4242 4242`
3. the app shows "confirming" until the real `checkout.session.completed` event has been processed by the local `stripe-webhook` function, then "ready"; a replayed delivery grants nothing more
4. book the class with the pass (`book_class`), see it in My bookings with the pass one class down, cancel (`cancel_booking`), see the class returned, book it again
5. pay for a single class (drop-in): booking and transaction rows exist, the confirmation email is attempted once

Assertions read the database through the service role as well as the page, so a screen cannot pass by pretending.

## What it needs

- A **local** Supabase stack with this repo's migrations, including the local-only seed `00020` (the tests refuse to run against anything but `127.0.0.1` / `localhost`).
- Edge Functions served with a Stripe **test** secret key, `STRIPE_WEBHOOK_SECRET`, `APP_URL`, `EMAIL_PROVIDER=console` and `BOOKING_NOTIFICATIONS_SECRET`; the Vault secrets `booking_notifications_url` / `booking_notifications_secret` set in the local database.
- The app built against the local stack and served on `E2E_BASE_URL` (default `http://127.0.0.1:4180`), with `VITE_LIVE_DATA_ONLY=true`.
- Environment: `E2E_SUPABASE_URL`, `E2E_ANON_KEY`, `E2E_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (must start `sk_test_`), `E2E_WEBHOOK_SECRET` (the same value the functions were served with), optionally `E2E_STUDIO_SLUG`.

Stripe cannot call a local machine, so the test fetches the event Stripe produced from the Stripe API and delivers it to the local function, signed with the local secret. That is what `stripe listen --forward-to` does.

```bash
npx playwright install chromium
npm run test:e2e
```

These tests are not part of `npm test` or CI: they need Docker and a Stripe test key. They create test-mode objects (customers, payments) in the Stripe sandbox the key belongs to. If that sandbox has a webhook endpoint registered, it also receives the events; the ids in them do not exist anywhere else, so the handler ignores them.
