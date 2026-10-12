#!/usr/bin/env bash
# Isolated local Supabase stack for the browser end-to-end tests (e2e/).
#
# Copies supabase/ into a separate working directory with its own project id
# and ports, so it never collides with another local stack on the same host
# (for example the Stage B harness, which uses the repo's own config.toml).
# Everything here is local: default development keys, a placeholder Stripe
# test key that is never sent to Stripe, and a made-up webhook signing secret.
#
#   scripts/e2e-stack.sh up       start (or re-sync and start) the stack
#   scripts/e2e-stack.sh reset    re-apply every migration, including the local seed
#   scripts/e2e-stack.sh sync     copy supabase/ again without restarting
#   scripts/e2e-stack.sh status   print the stack's connection settings
#   scripts/e2e-stack.sh down     stop it and delete its data
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="${E2E_STACK_DIR:-$HOME/.cache/roam-tandava-e2e-stack}"
PROJECT_ID="${E2E_PROJECT_ID:-roam-tandava-e2e}"
PORT_BASE="${E2E_PORT_BASE:-563}" # API 56321, database 56322, ...
APP_URL="${E2E_APP_URL:-http://127.0.0.1:4173}"
SUPABASE="${SUPABASE_BIN:-supabase}"

sync() {
  # Copy in place: running containers bind-mount this directory.
  mkdir -p "$STACK/supabase"
  rm -rf "$STACK/supabase/migrations"
  cp -r "$REPO/supabase/." "$STACK/supabase/"
  local config="$STACK/supabase/config.toml"
  sed -i "s/^project_id = .*/project_id = \"$PROJECT_ID\"/" "$config"
  sed -i -E "s/^(port|shadow_port) = 543([0-9]{2})$/\1 = ${PORT_BASE}\2/" "$config"
  sed -i "s/^inspector_port = .*/inspector_port = ${PORT_BASE}83/" "$config"
  sed -i "s#^site_url = .*#site_url = \"$APP_URL\"#" "$config"
  cat > "$STACK/supabase/functions/.env" <<ENV
STRIPE_SECRET_KEY=sk_test_local_placeholder_never_sent_to_stripe
STRIPE_WEBHOOK_SECRET=whsec_local_e2e_only
APP_URL=$APP_URL
EMAIL_PROVIDER=console
ENV
}

case "${1:-up}" in
  sync) sync ;;
  up) sync; cd "$STACK"; "$SUPABASE" start -x studio,imgproxy,logflare,vector,realtime,storage-api,postgres-meta,supavisor ;;
  reset) sync; cd "$STACK"; "$SUPABASE" db reset --local --yes ;;
  status) cd "$STACK"; "$SUPABASE" status -o env ;;
  down) cd "$STACK"; "$SUPABASE" stop --no-backup ;;
  *) echo "usage: $0 up|reset|sync|status|down" >&2; exit 2 ;;
esac
