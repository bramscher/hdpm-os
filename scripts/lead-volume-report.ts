/**
 * Read-only: real AppFolio lead (guest card) volume by week and source, so
 * the Guest Card Volume trend can be checked against source data.
 *
 * Writes nothing. Leads come from /leads filtered by LastUpdatedAtFrom (the
 * only date filter the v0 API takes), then are bucketed by CreatedAt.
 *
 * Usage: npx tsx scripts/lead-volume-report.ts [since=2026-05-01]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { SOURCE_BUCKETS } from '../lib/appfolio-kpi';

const since = process.argv[2] || '2026-05-01';

const AUTH = Buffer.from(
  `${process.env.APPFOLIO_CLIENT_ID}:${process.env.APPFOLIO_CLIENT_SECRET}`
).toString('base64');
const HEADERS = {
  Authorization: `Basic ${AUTH}`,
  'X-AppFolio-Developer-ID': process.env.APPFOLIO_DEVELOPER_ID!,
  Accept: 'application/json',
};

interface Lead {
  Id: string;
  CreatedAt: string;
  Source: string | null;
}

async function fetchLeads(): Promise<Lead[]> {
  const rows: Lead[] = [];
  let url: string | null =
    `https://api.appfolio.com/api/v0/leads?filters[LastUpdatedAtFrom]=${encodeURIComponent(
      new Date(since).toISOString()
    )}&page[size]=100`;
  for (let p = 0; p < 200 && url; p++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      p--;
      continue;
    }
    if (!res.ok) throw new Error(`/leads HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Lead[]; next_page_path?: string | null };
    rows.push(...(json.data || []));
    url = json.next_page_path ? `https://api.appfolio.com${json.next_page_path}` : null;
    await new Promise((r) => setTimeout(r, 350));
  }
  return rows;
}

function mondayOf(iso: string): string {
  const d = new Date(iso);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

async function main() {
  const leads = (await fetchLeads()).filter((l) => l.CreatedAt >= new Date(since).toISOString());
  console.log(`${leads.length} leads created since ${since}\n`);

  const buckets = [...new Set(Object.values(SOURCE_BUCKETS)), 'Other'];
  const weeks = new Map<string, Map<string, number>>();
  const rawOther = new Map<string, number>();
  for (const l of leads) {
    const bucket = (l.Source && SOURCE_BUCKETS[l.Source]) || 'Other';
    if (bucket === 'Other') rawOther.set(l.Source ?? '(blank)', (rawOther.get(l.Source ?? '(blank)') ?? 0) + 1);
    const week = weeks.get(mondayOf(l.CreatedAt)) ?? new Map<string, number>();
    week.set(bucket, (week.get(bucket) ?? 0) + 1);
    weeks.set(mondayOf(l.CreatedAt), week);
  }

  const used = buckets.filter((b) => [...weeks.values()].some((w) => w.has(b)));
  console.log(['week_of', 'total', ...used].join(','));
  for (const [week, counts] of [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const total = [...counts.values()].reduce((s, n) => s + n, 0);
    console.log([week, total, ...used.map((b) => counts.get(b) ?? 0)].join(','));
  }

  console.log('\nRaw Source values bucketed as Other:');
  for (const [raw, n] of [...rawOther.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}\t${raw}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
