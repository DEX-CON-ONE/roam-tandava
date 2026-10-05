# Tandava Stage B local spike

Date: 2026-10-04

This is local-only evidence. No hosted Roam credentials, Stripe keys, or secrets
are required or used. Stripe payment acceptance is intentionally out of scope.

## Reproduction

```sh
/home/gareth/.local/bin/supabase start
/home/gareth/.local/bin/supabase db reset --local --yes
/home/gareth/.local/bin/supabase db reset --local --yes
supabase/tests/spike_stage_b.sh
```

The harness is a checked-in SQL fixture and shell entry point. It uses the local
Postgres `request.jwt.claim.sub` setting to exercise `auth.uid()` under RLS and
the same `book_class`/`cancel_booking` database contracts used by the app.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Clean local migration reset | PASS | `supabase db reset --local --yes` completed twice on PostgreSQL 17 from migration 00001 through 00018. |
| RLS isolation A → B | PASS | Harness checks no Studio B studios, schedule, members, or bookings are visible to Studio A member. |
| RLS isolation B → A | PASS | Harness checks no Studio A studio or schedule is visible to Studio B-only member. |
| Booking and entitlement accounting | PASS | Confirmed booking increments membership usage and occurrence count. |
| Capacity limit | PASS | Second member becomes waitlisted at capacity. |
| Double booking | PASS | Database unique constraint rejects the same member/occurrence twice. |
| On-time cancellation | PASS | `cancel_booking` refunds membership, promotes waitlist, and consumes the promoted member's pack. |
| Late cancellation | PASS | `cancel_booking` retains the consumed entitlement and records the configured fee transaction. |
| Waitlist entitlement consistency | PASS after smallest fix | The original promotion trigger changed status without consuming the promoted member's class pack/membership. Migration 00001 now consumes exactly once on promotion; the harness covers this invariant. |
| Authenticated app journey | NOT PROVABLE | The local database/RPC path is covered, but this spike does not add browser automation or a committed test account. |
| Azure Communication Services email | FAIL / smallest fix disclosed | Existing Edge Function supports Resend, SendGrid, SMTP relay, and console only. ACS Email REST requires a dedicated provider adapter and sender-domain/API configuration; no credentials are used in this local spike. |
| Local email delivery | PASS (console boundary only) | Existing `email` Edge Function's console provider is credential-free and reports a terminal success result; ACS delivery cannot be claimed. |
| Stripe | NOT PROVEN | Checkout and webhook code now enforce test-mode by default, verify signed events, deduplicate event IDs, and map subscription statuses through directly tested production helpers. Real test-mode Checkout, Stripe delivery, and deployment secrets are intentionally not proven until the deployment slice. |

## Verdict

**CONDITIONAL PASS for the local database/RLS/booking boundary.** The checked-in
harness is reproducible and passes the covered backend checks. The full requested
spike cannot be called an end-to-end production-readiness PASS because browser
journey evidence and ACS delivery are not provable without adding browser
automation and the smallest ACS provider adapter/configuration. No payment
acceptance claim is made.

Stripe test-mode Checkout is **NOT PROVEN until the deployment slice**. This
branch uses no Stripe credentials; hosted Checkout, deployed Edge Function
secrets, and a real signed Stripe delivery must be exercised there.

The waitlist promotion defect found during this spike was fixed at the shared
database trigger boundary, rather than papered over in the harness.
