#!/usr/bin/env bash
# Backfill the OneDrive/SharePoint knowledge corpus by calling the sync route
# repeatedly (40 files/call) until it reports pending:0.
#   ! scripts/sync-onedrive.sh                 # prod, loops to completion
#   ! scripts/sync-onedrive.sh once            # single call
#   BASE=http://localhost:3000 ! scripts/sync-onedrive.sh   # override target
set -euo pipefail

BASE="${BASE:-https://hdpmchat.highdesertpm.com}"
ENVFILE="${ENVFILE:-.env.local}"
SECRET="${CRON_SECRET:-$( [ -f "$ENVFILE" ] && grep '^CRON_SECRET=' "$ENVFILE" | head -1 | cut -d= -f2- | tr -d '"' )}"
[ -n "$SECRET" ] || { echo "CRON_SECRET not found (set CRON_SECRET=... or add it to $ENVFILE)"; exit 1; }

while :; do
  resp=$(curl -s -X POST "$BASE/api/sync/knowledge?target=onedrive" \
              -H "Authorization: Bearer $SECRET")
  echo "$resp" | jq -c '.onedrive_docs // .'
  pending=$(echo "$resp" | jq -r '.onedrive_docs.pending // 0')
  [ "${1:-}" = "once" ] && break
  [ "$pending" -gt 0 ] 2>/dev/null || break
  echo "  …$pending still pending, continuing"
done
