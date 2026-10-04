# Tandava local Supabase spike

**Date:** 2026-10-04  
**Scope:** disposable local Supabase only; no hosted project, Stripe key, or credential was used.  
**Source:** pinned at `68bf39e5fbbd3c64ac18f304d56235b728bea1be` (the issue's upstream commit).

## Verdict: FAIL — stop before fork/config or client link-up

The disposable local database could not apply the complete migration set. Both the
first run and a clean second run stopped at migration `00005_connector_infrastructure.sql`
with PostgreSQL 17 error `cannot determine type of empty array (SQLSTATE 42P18)`.
The failing seed row uses an untyped `ARRAY[]` for `known_versions` in the
`generic-csv-import` connector definition. Because migrations do not complete, the
booking, RLS, entitlement, cancellation, email, and browser checks were not run and
must not be described as passing.

## Reproduction

Commands were run from the repository root with the official local CLI
`/home/gareth/.local/bin/supabase` version `2.119.0` and Docker only:

```text
/home/gareth/.local/bin/supabase init --force
/home/gareth/.local/bin/supabase start
# Result: function bundle path error from generated local config; no credentials used.
/home/gareth/.local/bin/supabase stop --no-backup

/home/gareth/.local/bin/supabase start --exclude edge-runtime,studio,logflare,vector,postgres-meta,storage-api,imgproxy,realtime,gotrue,kong,mailpit,postgrest,supavisor --ignore-health-check
# Result: migration 00005_connector_infrastructure.sql fails with
# ERROR: cannot determine type of empty array (SQLSTATE 42P18)
/home/gareth/.local/bin/supabase stop --no-backup

# The same database-only start command was run a second time from a clean stop.
# It failed at the same migration and statement, proving the result is repeatable.
```

The generated `supabase/config.toml` and `.gitignore` are local CLI setup artefacts
and are intentionally not part of this evidence change.

## Checks

| Check | Result | Evidence / reason |
|---|---|---|
| Pinned source | PASS | `git rev-parse HEAD` = `68bf39e5fbbd3c64ac18f304d56235b728bea1be` |
| Local Supabase CLI | PASS | Official `/home/gareth/.local/bin/supabase` reports `2.119.0`; Docker is local |
| Migrations apply | **FAIL** | Repeatable PostgreSQL 17 `ARRAY[]` type error in migration 00005 |
| Migrations safely rerun | **FAIL / not reached** | Clean second start reaches the same failure; no complete schema exists to rerun |
| Two-studio fixtures | NOT RUN | Blocked by migration failure |
| RLS isolation both ways | NOT RUN | Blocked by migration failure |
| Book/cancel/capacity/double-booking | NOT RUN | Blocked by migration failure |
| Static booking/cancellation journey | NOT RUN | Blocked by migration failure |
| ACS email provider and terminal delivery status | NOT RUN | No provider credential was requested or used; blocked before Edge Function validation |
| Stripe checkout/webhook | NOT RUN | Explicitly out of scope; no Stripe keys used |

## Recommendation / fallback

Fix and review the migration's typed empty-array value before rerunning this spike.
Do not switch to Cal.com yet: the fallback is only relevant after the Tandava
validation has a complete, reproducible result. If the migration fix exposes further
backend incompatibilities, record those results before deciding between Tandava and
Cal.com on the same Supabase Postgres.
