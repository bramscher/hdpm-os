#!/usr/bin/env bash
# Fire a Loop 1 pilot estimate-chase run against production.
# Usage:
#   bash scripts/pilot-fire.sh email   # 3 Outlook drafts into Craig+Brody
#   bash scripts/pilot-fire.sh sms     # 3 tappable Slack cards (shadow)
# Reads CRON_SECRET from .env.local so nothing sensitive is typed.

set -euo pipefail

CHANNEL="${1:-email}"
N="${2:-3}"
BASE="https://hdpm-chatbot.vercel.app"

SECRET="$(grep -E '^CRON_SECRET=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')"
if [ -z "$SECRET" ]; then
  echo "ERROR: CRON_SECRET not found in .env.local (run from the project root)" >&2
  exit 1
fi

echo "→ POST ${BASE}/api/agents/cron/estimate-chaser?pilotSeed=${N}&seedChannel=${CHANNEL}"
curl -s -X POST \
  "${BASE}/api/agents/cron/estimate-chaser?pilotSeed=${N}&seedChannel=${CHANNEL}" \
  -H "Authorization: Bearer ${SECRET}"
echo
