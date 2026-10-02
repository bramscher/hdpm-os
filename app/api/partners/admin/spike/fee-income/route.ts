import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin } from '@/lib/referrals/admin';
import { reportsApiConfigured, runReport } from '@/lib/appfolio-reports';
import { describeColumns, monthRange, propertyLines, summarizeByProperty, type Row } from '@/lib/referrals/fee-income-spike';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET /api/partners/admin/spike/fee-income?month=2026-09[&property=Pine]
 *
 * Batch 6a feasibility probe (read-only, admin-only). Tries candidate AppFolio
 * Reports API reports for one month and reports, for each: was the report name
 * / filter shape accepted, which columns came back, which management-fee GL
 * accounts matched, and fee totals per property. No raw rows or owner names;
 * `property` adds that one property's fee lines to hold against its owner
 * statement. Fresh report runs are limited to 7 per 15s, so attempts are
 * spaced ~2.5s apart.
 */

type Filters = Record<string, unknown>;
interface Candidate {
  report: string;
  variants: (r: { from: string; to: string }) => Filters[];
}

const CANDIDATES: Candidate[] = [
  {
    report: 'bill_detail',
    variants: ({ from, to }) => [
      {
        occurred_on_from: from,
        occurred_on_to: to,
        columns: ['property_name', 'property_id', 'account_number', 'account_name', 'paid', 'unpaid', 'payment_date', 'bill_date', 'payee_name', 'description'],
      },
      { occurred_on_from: from, occurred_on_to: to },
    ],
  },
  {
    report: 'general_ledger',
    variants: ({ from, to }) => [
      { posted_on_from: from, posted_on_to: to },
      { occurred_on_from: from, occurred_on_to: to },
      { from_date: from, to_date: to },
    ],
  },
  {
    report: 'income_statement',
    variants: ({ from, to }) => [
      { posted_on_from: from, posted_on_to: to, accounting_basis: 'Cash' },
      { period_from: from, period_to: to },
      { occurred_on_from: from, occurred_on_to: to },
    ],
  },
  {
    report: 'twelve_month_income_statement',
    variants: ({ to }) => [{ posted_on_to: to }, { period_to: to }],
  },
  { report: 'owner_statement', variants: ({ from, to }) => [{ occurred_on_from: from, occurred_on_to: to }] },
  { report: 'owner_statement_summary', variants: ({ from, to }) => [{ occurred_on_from: from, occurred_on_to: to }] },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: NextRequest) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  if (!reportsApiConfigured()) return NextResponse.json({ error: 'AppFolio Reports API credentials not configured' }, { status: 503 });

  const month = request.nextUrl.searchParams.get('month') ?? '';
  const range = monthRange(month);
  if (!range) return NextResponse.json({ error: 'month must be YYYY-MM, e.g. ?month=2026-09' }, { status: 400 });
  const property = request.nextUrl.searchParams.get('property')?.trim() || null;

  const results: unknown[] = [];
  let calls = 0;
  for (const c of CANDIDATES) {
    const attempts: unknown[] = [];
    for (const filters of c.variants(range)) {
      if (calls > 0) await sleep(2500);
      calls++;
      const shape = Object.keys(filters).filter((k) => k !== 'columns').join(',') + ('columns' in filters ? ' +columns' : '');
      try {
        const rows = await runReport<Row>(c.report, filters);
        const cols = describeColumns(rows);
        attempts.push({
          filters: shape,
          ok: true,
          columns: cols,
          summary: summarizeByProperty(rows, cols),
          ...(property ? { propertyLines: propertyLines(rows, cols, property) } : {}),
        });
        break; // accepted: no need to try other filter shapes
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = Number(/failed \((\d{3})\)/.exec(message)?.[1]) || null;
        attempts.push({ filters: shape, ok: false, status, error: message.slice(0, 400) });
        if (status === 404) break; // report name not available for this account
      }
    }
    results.push({ report: c.report, attempts });
  }

  return NextResponse.json({
    month,
    range,
    property,
    reportCalls: calls,
    note: 'Compare a property\'s total to the "Management Fees" line on its owner statement for this month.',
    results,
  });
}
