#!/usr/bin/env bash
#
# Trigger the estimate-chaser cron ad-hoc against production.
#
# Usage:
#   bash scripts/fire-estimate-chaser.sh          # dry run (default, SAFE)
#   bash scripts/fire-estimate-chaser.sh dry      # same
#   bash scripts/fire-estimate-chaser.sh live     # REAL run (creates drafts + Slack)
#
#   dry  — computes the pool + decisions and returns counts. Writes NOTHING:
#          no Outlook drafts, no Slack, no owner-name AppFolio lookup.
#   live — the real daily behavior: creates vendor-chase + owner-approval Outlook
#          DRAFTS (review-before-send, in the owner mailbox = craig@), resolves real
#          owner names, and sends the escalation Slack DM to Brody + Matt. SMS is
#          shadowed (AGENT_PILOT_SHADOW=1) so no vendor texts go out.
#
# Reads CRON_SECRET from .env.local. Run from the repo root.
set -euo pipefail

MODE="${1:-dry}"
ENV_FILE=".env.local"
URL="https://os.highdesertpm.com/api/agents/cron/estimate-chaser"

if [ ! -f "$ENV_FILE" ]; then echo "no $ENV_FILE (run from repo root)"; exit 1; fi
CS=$(grep '^CRON_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/[[:space:]"'"'"']//g')
if [ -z "$CS" ]; then echo "CRON_SECRET not found in $ENV_FILE"; exit 1; fi

if [ "$MODE" = "live" ]; then
  echo "⚠️  LIVE run — creates Outlook drafts (craig@) + escalation Slack to Brody/Matt."
  read -r -p "Proceed? [y/N] " ok
  [ "$ok" = "y" ] || { echo "aborted"; exit 0; }
else
  URL="$URL?dryRun=1"
  echo "Dry run (writes nothing)…"
fi

echo "POST $URL"
BODY=$(mktemp)
CODE=$(curl -s -o "$BODY" -w "%{http_code}" -X POST "$URL" -H "authorization: Bearer $CS")
REDIR=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST "$URL" -H "authorization: Bearer $CS" || true)
echo "HTTP $CODE"
[ -n "$REDIR" ] && echo "redirects to: $REDIR"
echo "--- response body ---"
if python3 -m json.tool < "$BODY" 2>/dev/null; then :; else head -c 800 "$BODY"; echo; fi
rm -f "$BODY"
