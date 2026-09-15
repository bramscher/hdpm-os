export type InvoiceReportPeriod = { label: string; from: string; to: string };

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateLabel(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Report presets use the company's Pacific calendar and inclusive end dates. */
export function invoiceReportPeriods(
  now = new Date(),
  count = 3,
): {
  payroll: InvoiceReportPeriod[];
  weeks: InvoiceReportPeriod[];
} {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const current = new Date(`${today}T12:00:00Z`);
  const payroll: InvoiceReportPeriod[] = [];
  let year = current.getUTCFullYear(),
    month = current.getUTCMonth();
  let firstHalf = current.getUTCDate() <= 15;
  const monday = new Date(current);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weeks: InvoiceReportPeriod[] = [];
  for (let i = 0; i < count; i++) {
    const from = day(new Date(Date.UTC(year, month, firstHalf ? 1 : 16)));
    const to = day(
      new Date(
        Date.UTC(year, firstHalf ? month : month + 1, firstHalf ? 15 : 0),
      ),
    );
    payroll.push({ from, to, label: `${dateLabel(from)} – ${dateLabel(to)}` });
    if (firstHalf) {
      month--;
      if (month < 0) {
        month = 11;
        year--;
      }
    }
    firstHalf = !firstHalf;
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const weekFrom = day(monday),
      weekTo = day(sunday);
    weeks.push({
      from: weekFrom,
      to: weekTo,
      label: `${dateLabel(weekFrom)} – ${dateLabel(weekTo)}`,
    });
    monday.setUTCDate(monday.getUTCDate() - 7);
  }
  return { payroll, weeks };
}
