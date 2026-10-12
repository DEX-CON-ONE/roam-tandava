-- Enable row level security on 13 public tables that migrations 00001-00019
-- left reachable through the publishable (anon) key via PostgREST.
--
-- Numbering: 00020_roam_local_seed.sql is a local-only fixture and is NOT
-- applied to hosted projects, so this migration is 00021 to sort after it.
-- Applying 00021 to a project that skipped 00020 is fine; there is no
-- dependency between the two.
--
-- Deliberately NO policies are created. With RLS enabled and no policy, anon
-- and authenticated are denied everything; the service role (Edge Functions,
-- dashboard, migrations) bypasses RLS and is unaffected. Audit of src/ and
-- supabase/functions/ found no browser or Edge Function access to any of
-- these 13 tables, so nothing needs a policy today. Add narrowly scoped
-- policies in the same migration as the feature that first needs them.
--
-- ENABLE ROW LEVEL SECURITY is idempotent; re-running is a no-op.

-- Audit / PII (rows contain actor emails)
ALTER TABLE audit_logs_archive ENABLE ROW LEVEL SECURITY;

-- Zoom (host URLs, meeting passwords, encrypted credentials)
ALTER TABLE class_zoom_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE virtual_class_settings ENABLE ROW LEVEL SECURITY;

-- Import reference data (no client reads them; import-members does not use them)
ALTER TABLE import_error_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_field_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_format_versions ENABLE ROW LEVEL SECURITY;

-- On-demand subscriptions (provider subscription ids, member status)
ALTER TABLE on_demand_member_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE on_demand_subscriptions ENABLE ROW LEVEL SECURITY;

-- On-demand video join/activity tables (per-member viewing and ratings)
ALTER TABLE student_playlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_series_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_watch_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE audit_logs_archive IS
  'RLS on, no policies: service role only. Add an admin SELECT policy mirroring audit_logs if a UI ever reads it.';
COMMENT ON TABLE virtual_class_settings IS
  'RLS on, no policies: service role only (holds encrypted Zoom credentials).';
COMMENT ON TABLE class_zoom_meetings IS
  'RLS on, no policies: service role only (holds Zoom host URL and password).';
