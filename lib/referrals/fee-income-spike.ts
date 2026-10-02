/**
 * Batch 6a — trailing-fee data spike: pure analysis of AppFolio report rows.
 *
 * The question: can a Reports API report give REAL management-fee income per
 * property per month (reconcilable to an owner statement)? The probe route
 * runs candidate reports; these helpers find the fee lines and summarize them
 * without returning raw rows (no owner names, only property totals).
 */

export type Row = Record<string, unknown>;

/** Management-fee account names ("Management Fees", "Mgmt Fee - Residential"), not other fees. */
export function matchFeeAccount(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  return /\bmanagement\s+fees?\b|\bmgmt\.?\s+fees?\b|\bproperty\s+management\b/i.test(name);
}

const find = (keys: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const k = keys.find((x) => p.test(x));
    if (k) return k;
  }
  return null;
};

export interface ColumnMap {
  all: string[];
  account: string | null;
  accountNumber: string | null;
  amount: string | null;
  /** When a report splits debit/credit, fee = debit − credit (reversals post as credits). */
  credit: string | null;
  propertyName: string | null;
  propertyId: string | null;
  propertyIntegrationId: string | null;
  date: string | null;
  description: string | null;
}

/** Which columns hold the account, amount, property and date (report shapes differ). */
export function describeColumns(rows: Row[]): ColumnMap {
  const all = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))].sort();
  return {
    all,
    account: find(all, /^account_name$/, /gl_account_name/, /^account$/, /account_name/, /^gl_account$/),
    accountNumber: find(all, /^account_number$/, /gl_account_number/, /account_code/, /account_number/),
    amount: find(all, /^amount$/, /^paid$/, /^net_amount$/, /^debit$/, /amount/, /^total$/),
    credit: all.includes('debit') && all.includes('credit') && !all.includes('amount') ? 'credit' : null,
    propertyName: find(all, /^property_name$/, /^property$/, /property_name/),
    propertyId: find(all, /^property_id$/),
    propertyIntegrationId: find(all, /^property_integration_id$/, /property_integration/),
    date: find(all, /^date$/, /^occurred_on$/, /^post(ed)?_date$/, /bill_date/, /payment_date/, /date/),
    description: find(all, /^description$/, /^memo$/, /^remarks$/, /description/),
  };
}

export const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const neg = /^\(.*\)$/.test(v.trim());
  const n = Number(v.replace(/[$,()\s]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A row's fee amount: debit − credit when the report splits them, else the amount column. */
export const rowAmount = (r: Row, cols: ColumnMap): number =>
  round2((cols.amount ? toNumber(r[cols.amount]) : 0) - (cols.credit ? toNumber(r[cols.credit]) : 0));

export interface FeeSummary {
  rows: number;
  feeRows: number;
  matchedAccounts: { name: string; number: string | null; rows: number; total: number }[];
  properties: number;
  total: number;
  topProperties: { property: string; propertyId: string | null; integrationId: string | null; total: number; lines: number }[];
  joinable: boolean;
}

/** Fee lines per property for one report's rows. */
export function summarizeByProperty(rows: Row[], cols: ColumnMap, top = 15): FeeSummary {
  const accounts = new Map<string, { name: string; number: string | null; rows: number; total: number }>();
  const props = new Map<string, FeeSummary['topProperties'][number]>();
  let feeRows = 0;
  let total = 0;
  for (const r of rows) {
    const acct = cols.account ? r[cols.account] : null;
    if (!matchFeeAccount(acct)) continue;
    feeRows++;
    const amt = rowAmount(r, cols);
    total += amt;
    const num = cols.accountNumber ? String(r[cols.accountNumber] ?? '') || null : null;
    const a = accounts.get(String(acct)) ?? { name: String(acct), number: num, rows: 0, total: 0 };
    a.rows++;
    a.total = round2(a.total + amt);
    accounts.set(String(acct), a);

    const pName = cols.propertyName ? String(r[cols.propertyName] ?? '') : '';
    const pId = cols.propertyId ? String(r[cols.propertyId] ?? '') || null : null;
    const pInt = cols.propertyIntegrationId ? String(r[cols.propertyIntegrationId] ?? '') || null : null;
    const key = pInt || pId || pName || '(no property)';
    const p = props.get(key) ?? { property: pName || '(no property column)', propertyId: pId, integrationId: pInt, total: 0, lines: 0 };
    p.total = round2(p.total + amt);
    p.lines++;
    props.set(key, p);
  }
  return {
    rows: rows.length,
    feeRows,
    matchedAccounts: [...accounts.values()].sort((a, b) => b.rows - a.rows),
    properties: props.size,
    total: round2(total),
    topProperties: [...props.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, top),
    joinable: !!(cols.propertyId || cols.propertyIntegrationId),
  };
}

/** One property's fee lines, for holding against its owner statement. */
export function propertyLines(rows: Row[], cols: ColumnMap, property: string) {
  const needle = property.trim().toLowerCase();
  return rows
    .filter((r) => matchFeeAccount(cols.account ? r[cols.account] : null))
    .filter((r) => String(cols.propertyName ? r[cols.propertyName] : '').toLowerCase().includes(needle))
    .slice(0, 100)
    .map((r) => ({
      date: cols.date ? r[cols.date] ?? null : null,
      account: cols.account ? r[cols.account] : null,
      amount: cols.amount ? rowAmount(r, cols) : null,
      description: cols.description ? String(r[cols.description] ?? '').slice(0, 160) : null,
      property: cols.propertyName ? r[cols.propertyName] : null,
    }));
}

/** First and last day of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` };
}
