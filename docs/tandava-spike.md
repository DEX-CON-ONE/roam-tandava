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
| Stripe | OUT OF SCOPE | No Stripe keys or payment acceptance test used. |

## Verdict

**CONDITIONAL PASS for the local database/RLS/booking boundary.** The checked-in
harness is reproducible and passes the covered backend checks. The full requested
spike cannot be called an end-to-end production-readiness PASS because browser
journey evidence and ACS delivery are not provable without adding browser
automation and the smallest ACS provider adapter/configuration. No payment
acceptance claim is made.

The waitlist promotion defect found during this spike was fixed at the shared
database trigger boundary, rather than papered over in the harness.

## Issue #7 Roam fixture and walkthrough

Migration `00019_roam_local_seed.sql` creates the local-only `ROAM Athletic Club`
fixture. It is rerunnable and uses only published Roam facts:

- Farnham Park, GU35 9LW
- UNDEFEATED: Wednesday 09:30 and Saturday 08:30
- HYBRID, X4, and Farnham Park Outdoor Training offerings
- Personal Training is not seeded as bookable

Prices, instructors, and other unpublished commercial details remain unknown
rather than being invented. The schema's existing duration and capacity defaults
are used only for the local harness and are not presented as Roam facts; replace
them when Roam supplies an authoritative schedule.

The walkthrough requires a running local Supabase stack and browser session. No
credentials or screenshots are committed by this change. Capture sanitized
screenshots at both `1280x800` and `390x844` under `docs/spike-screenshots/`.

| Journey step | 1280×800 | 390×844 | Result / note |
| --- | --- | --- | --- |
| Sign in | TODO | TODO | Requires local auth user; no credentials in repo |
| Pick a class | TODO | TODO | Verify Roam schedule renders |
| Book a class | TODO | TODO | Verify confirmed booking and entitlement |
| Cancel outside 24h | TODO | TODO | Verify on-time cancellation/refund |
| Cancel inside 24h | TODO | TODO | Verify late-cancel behaviour |
| Full class | TODO | TODO | Verify waitlist action |
| Waitlist | TODO | TODO | Verify waitlist status and promotion path |

The fork's existing `ThemeContext`/CSS custom-property boundary is used. Roam's
approved site values are applied through the seeded studio record: near-black
primary/secondary (`#1c1c1c`), white accent, and DM Sans. The canonical Roam
logo is not altered or copied into this fork.
