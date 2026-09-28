interface OutlookInspection { status: string; due_date: string | null; target_date: string | null }
export function buildInspectionOutlook(rows: OutlookInspection[], today: string) {
  const start = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1, 12));
    return { key: date.toISOString().slice(0, 7), label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }), pending: 0, scheduled: 0, total: 0 };
  });
  let overdue = 0, undated = 0;
  for (const row of rows) {
    if (['completed', 'canceled', 'cancelled'].includes(row.status)) continue;
    const date = row.target_date || row.due_date;
    if (!date) { undated++; continue; }
    if (date < today) { overdue++; continue; }
    const month = months.find(m => m.key === date.slice(0, 7));
    if (!month) continue;
    month.total++;
    if (row.target_date || ['scheduled', 'planned', 'dispatched', 'in_progress'].includes(row.status)) month.scheduled++;
    else month.pending++;
  }
  return { months, overdue, undated, total: months.reduce((sum, m) => sum + m.total, 0) + overdue + undated };
}
