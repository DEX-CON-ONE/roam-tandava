#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
supabase_bin="${SUPABASE_BIN:-/home/gareth/.local/bin/supabase}"

if ! "$supabase_bin" status >/dev/null 2>&1; then
  echo "Supabase local stack is not running; start it with: $supabase_bin start" >&2
  exit 2
fi

db_url="$($supabase_bin status -o env | awk -F= '/^DB_URL=/{sub(/^DB_URL=/, ""); print}')"
if [[ -z "$db_url" ]]; then
  echo "Could not read DB_URL from supabase status" >&2
  exit 2
fi

if command -v psql >/dev/null 2>&1; then
  psql "$db_url" --set ON_ERROR_STOP=1 --file "$repo_root/supabase/tests/spike_stage_b.sql"
else
  container="$(docker ps --format '{{.Names}}' | awk '/^supabase_db_/ {print; exit}')"
  if [[ -z "$container" ]]; then
    echo "Could not find the local Supabase database container" >&2
    exit 2
  fi
  docker exec -i "$container" psql postgresql://postgres:postgres@127.0.0.1:5432/postgres \
    --set ON_ERROR_STOP=1 < "$repo_root/supabase/tests/spike_stage_b.sql"
fi
