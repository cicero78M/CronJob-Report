#!/usr/bin/env bash
set -euo pipefail

pass_count=0

check_pattern() {
  local description="$1"
  local pattern="$2"
  local target="$3"

  if rg -n --fixed-strings "$pattern" "$target" >/dev/null; then
    echo "[PASS] $description"
    pass_count=$((pass_count + 1))
  else
    echo "[FAIL] $description"
    echo "       pattern: $pattern"
    echo "       target : $target"
    exit 1
  fi
}

check_pattern \
  "Function signature fetchAndStoreInstaContent exists" \
  "export async function fetchAndStoreInstaContent(" \
  "src/handler/fetchpost/instaFetchPost.js"

check_pattern \
  "WIB filter helper isTodayJakarta is present" \
  "function isTodayJakarta(unixTimestamp)" \
  "src/handler/fetchpost/instaFetchPost.js"

check_pattern \
  "Daily filter query still uses DATE(created_at)" \
  "DATE(created_at) = \$1" \
  "src/handler/fetchpost/instaFetchPost.js"

check_pattern \
  "Delete guard executes only after successful fetch" \
  "if (hasSuccessfulFetch)" \
  "src/handler/fetchpost/instaFetchPost.js"

check_pattern \
  "Main upsert strategy still uses shortcode conflict" \
  "ON CONFLICT (shortcode) DO UPDATE" \
  "src/handler/fetchpost/instaFetchPost.js"

check_pattern \
  "Cron expression for amplify routine update remains defined" \
  "const CRON_EXPRESSION = '55,25 8-21 * * *';" \
  "src/cron/cronOprRequestAmplifyRoutineUpdate.js"

check_pattern \
  "Cron timezone remains Asia/Jakarta" \
  "const CRON_OPTIONS = { timezone: 'Asia/Jakarta' };" \
  "src/cron/cronOprRequestAmplifyRoutineUpdate.js"

check_pattern \
  "Cron still calls fetchAndStoreInstaContent for each client" \
  "await fetchAndStoreInstaContent(null, null, null, client.client_id);" \
  "src/cron/cronOprRequestAmplifyRoutineUpdate.js"

echo "All fetch sync checks passed ($pass_count checks)."
