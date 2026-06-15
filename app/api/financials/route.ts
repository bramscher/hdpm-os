import { NextResponse } from 'next/server';
import { getLatestFinancials } from '@/lib/quickbooks';
import { getDashboardConfig } from '@/lib/dashboard-config';
import { requireAdmin } from '@/lib/require-admin';

export const maxDuration = 30;

/**
 * GET /api/financials — Section A owner-goal metrics.
 *
 * Combines the QuickBooks financials snapshot (revenue + booked opex) with the
 * config financial inputs (staff cost, debt service, goals) to derive true NOI,
 * owner distributable cash, DSCR, and progress to the $1M / $500K goals.
 *
 * QB does not book payroll, so a true NOI requires config.staffAnnualCost; until
 * it's set, the NOI-derived fields are null and `needsStaffCost` is true.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const [snap, config] = await Promise.all([
      getLatestFinancials(),
      getDashboardConfig(),
    ]);

    if (!snap) {
      return NextResponse.json({ seeded: false });
    }

    const { value: f, capturedAt } = snap;
    const { financials, targets } = config;
    const { staffAnnualCost, annualDebtService } = financials;

    const round = (n: number) => Math.round(n * 100) / 100;
    const round1 = (n: number) => Math.round(n * 10) / 10;

    const needsStaffCost = !(staffAnnualCost > 0);

    // True NOI = QB revenue − QB booked opex − annual staff/payroll cost.
    const adjustedNoiTTM = needsStaffCost
      ? null
      : round(f.revenueTTM - f.bookedOpexTTM - staffAnnualCost);

    const noiMarginPct =
      adjustedNoiTTM != null && f.revenueTTM > 0
        ? round1((adjustedNoiTTM / f.revenueTTM) * 100)
        : null;

    const ownerDistributableCash =
      adjustedNoiTTM != null ? round(adjustedNoiTTM - annualDebtService) : null;

    const dscr =
      adjustedNoiTTM != null && annualDebtService > 0
        ? round(adjustedNoiTTM / annualDebtService)
        : null;

    const noiProgressPct =
      adjustedNoiTTM != null && targets.netIncomeGoal > 0
        ? round1((adjustedNoiTTM / targets.netIncomeGoal) * 100)
        : null;

    const ownerCashProgressPct =
      ownerDistributableCash != null && targets.ownerCashGoal > 0
        ? round1((ownerDistributableCash / targets.ownerCashGoal) * 100)
        : null;

    return NextResponse.json({
      seeded: true,
      source: f.source,
      note: f.note ?? null,
      periodStart: f.periodStart,
      periodEnd: f.periodEnd,
      capturedAt,
      // Live from QuickBooks
      revenueTTM: f.revenueTTM,
      bookedOpexTTM: f.bookedOpexTTM,
      qbNetIncomeTTM: f.qbNetIncomeTTM,
      monthly: f.monthly,
      // Config inputs
      staffAnnualCost,
      annualDebtService,
      goals: {
        netIncomeGoal: targets.netIncomeGoal,
        ownerCashGoal: targets.ownerCashGoal,
      },
      // Derived (null until staff cost configured)
      needsStaffCost,
      adjustedNoiTTM,
      noiMarginPct,
      ownerDistributableCash,
      dscr,
      noiProgressPct,
      ownerCashProgressPct,
    });
  } catch (err) {
    console.error('[financials] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load financials' },
      { status: 500 }
    );
  }
}
