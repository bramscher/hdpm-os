'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ScoreboardRow } from '../board-types';

// AppFolio is the system of record for vendor insurance/license/W-9. We don't
// store or edit those here — we link out to the vendor record instead.
const APPFOLIO_WEB_BASE = 'https://highdesertpm.appfolio.com';
const vendorAppfolioUrl = (appfolioVendorId: string) =>
  `${APPFOLIO_WEB_BASE}/vendors/${appfolioVendorId}`;

function acceptTime(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 24) return `${Math.round(hours)} hr${Math.round(hours) === 1 ? '' : 's'}`;
  return `${(hours / 24).toFixed(1)} days`;
}

function rankLabel(row: ScoreboardRow, index: number): { text: string; cls: string } {
  if (row.demoted) return { text: 'Review Monday', cls: 'warn' };
  if (!row.vendor.appfolio_vendor_id && row.name.startsWith('HDMS')) {
    return { text: 'Dispatch 1st', cls: 'ok' };
  }
  // No 90-day assignment data yet → no numeric rank (a manual preferred/emergency
  // flag still shows, but there's no measured position to report).
  if (row.score === null) {
    if (row.vendor.preferred) return { text: 'Preferred', cls: 'ok' };
    if (row.vendor.emergency_available) return { text: 'Emergency', cls: 'ok' };
    return { text: '—', cls: '' };
  }
  if (row.vendor.preferred) return { text: `Preferred #${index + 1}`, cls: 'ok' };
  if (row.vendor.emergency_available) return { text: 'Emergency', cls: 'ok' };
  return { text: `#${index + 1}`, cls: '' };
}

function VendorEditPanel({
  row,
  onDone,
}: {
  row: ScoreboardRow;
  onDone: () => void;
}) {
  const v = row.vendor;
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState({
    trades: (v.trades ?? []).join(', '),
    service_area: v.service_area ?? '',
    hourly_rate: v.hourly_rate?.toString() ?? '',
    minimum_charge: v.minimum_charge?.toString() ?? '',
    emergency_available: v.emergency_available,
    preferred: v.preferred,
    demoted: v.demoted,
    active: v.active,
    property_restrictions: (v.property_restrictions ?? []).join(', '),
    notes: v.notes ?? '',
  });

  const set = (k: keyof typeof fields, val: string | boolean) =>
    setFields((f) => ({ ...f, [k]: val }));
  const csv = (s: string) =>
    s
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/maintenance/vendors/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trades: csv(fields.trades),
          service_area: fields.service_area || null,
          hourly_rate: fields.hourly_rate ? Number(fields.hourly_rate) : null,
          minimum_charge: fields.minimum_charge ? Number(fields.minimum_charge) : null,
          emergency_available: fields.emergency_available,
          preferred: fields.preferred,
          demoted: fields.demoted,
          active: fields.active,
          property_restrictions: csv(fields.property_restrictions),
          notes: fields.notes || null,
        }),
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const text = (label: string, key: keyof typeof fields, type = 'text') => (
    <label>
      <span className="mo-field-label">{label}</span>
      <input
        type={type}
        className="mo-input"
        value={fields[key] as string}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  const check = (label: string, key: keyof typeof fields) => (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
      <input
        type="checkbox"
        checked={fields[key] as boolean}
        onChange={(e) => set(key, e.target.checked)}
      />
      {label}
    </label>
  );

  return (
    <div className="mo-panel" style={{ marginBottom: 14 }}>
      <h2>Edit profile — {v.name}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {text('Trades (comma-sep)', 'trades')}
        {text('Service area', 'service_area')}
        {text('Hourly rate', 'hourly_rate', 'number')}
        {text('Minimum charge', 'minimum_charge', 'number')}
        {text('Property restrictions', 'property_restrictions')}
        {text('Notes', 'notes')}
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        Insurance, license &amp; W-9 are managed in AppFolio (the system of record) —
        {v.appfolio_vendor_id ? (
          <>
            {' '}
            <a
              href={vendorAppfolioUrl(v.appfolio_vendor_id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              open this vendor in AppFolio ↗
            </a>
          </>
        ) : (
          ' this vendor has no linked AppFolio record.'
        )}
      </p>
      <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        {check('Emergency available', 'emergency_available')}
        {check('Preferred', 'preferred')}
        {check('Demoted (Monday review)', 'demoted')}
        {check('Active', 'active')}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="mo-btn" disabled={saving} onClick={save}>
          Save profile
        </button>
        <button className="mo-btn secondary" disabled={saving} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type SortKey =
  | 'name'
  | 'open'
  | 'medianDaysOpen'
  | 'overdue'
  | 'history'
  | 'avgAcceptHours'
  | 'callbackRate'
  | 'score'
  | 'rank';

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: 'name', label: 'Vendor / Tech' },
  { key: 'open', label: 'Open' },
  { key: 'medianDaysOpen', label: 'Days open (med / avg)' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'history', label: 'History (all-time)' },
  { key: 'avgAcceptHours', label: 'Accept time (90d)' },
  { key: 'callbackRate', label: 'Callback (90d)' },
  { key: 'score', label: 'Score' },
  { key: 'rank', label: 'Rank' },
  { key: null, label: 'Docs / AppFolio' },
  { key: null, label: '' },
];

const SORT_KEYS = new Set(COLUMNS.map((c) => c.key).filter(Boolean) as SortKey[]);

export default function VendorScoreboard({
  scoreboard,
  onRefresh,
}: {
  scoreboard: ScoreboardRow[];
  onRefresh?: () => void;
}) {
  const [editing, setEditing] = useState<ScoreboardRow | null>(null);
  const onEdit = (row: ScoreboardRow) => setEditing(row);

  // Sort state lives in the URL (?sort=<col>&dir=asc|desc) so it survives a refresh.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sortKey = searchParams.get('sort');
  const sort =
    sortKey && SORT_KEYS.has(sortKey as SortKey)
      ? { key: sortKey as SortKey, dir: searchParams.get('dir') === 'desc' ? 'desc' : 'asc' }
      : null;

  // Rank is pinned to the server's score-sorted order so it stays meaningful
  // regardless of how the table is re-sorted for display below.
  const rankIndex = useMemo(() => {
    const m = new Map<string, number>();
    scoreboard.forEach((r, i) => m.set(r.vendorId, i));
    return m;
  }, [scoreboard]);

  const sorted = useMemo(() => {
    if (!sort) return scoreboard;
    const value = (row: ScoreboardRow): number | string | null => {
      switch (sort.key) {
        case 'name':
          return row.name.toLowerCase();
        case 'open':
          return row.open;
        case 'medianDaysOpen':
          return row.medianDaysOpen;
        case 'overdue':
          return row.overdue;
        case 'history':
          return row.history ? row.history.medianDays : null;
        case 'avgAcceptHours':
          return row.avgAcceptHours;
        case 'callbackRate':
          return row.assignments90d === 0 ? null : row.callbackRate;
        case 'score':
          return row.score;
        case 'rank':
          return rankIndex.get(row.vendorId) ?? 0;
      }
    };
    return [...scoreboard].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      // Missing values (no data / not on file) always sink to the bottom.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp =
        typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [scoreboard, sort, rankIndex]);

  // Click cycles: asc → desc → unsorted (back to rank order), persisted to the URL.
  const toggleSort = (key: SortKey) => {
    const next: { key: SortKey; dir: 'asc' | 'desc' } | null =
      !sort || sort.key !== key
        ? { key, dir: 'asc' }
        : sort.dir === 'asc'
          ? { key, dir: 'desc' }
          : null;

    const params = new URLSearchParams(searchParams.toString());
    if (next) {
      params.set('sort', next.key);
      params.set('dir', next.dir);
    } else {
      params.delete('sort');
      params.delete('dir');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <section>
      {editing && (
        <VendorEditPanel
          row={editing}
          onDone={() => {
            setEditing(null);
            onRefresh?.();
          }}
        />
      )}
      <table className="mo-table">
        <thead>
          <tr>
            {COLUMNS.map((col, idx) =>
              col.key ? (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key!)}
                  style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  title="Click to sort"
                >
                  {col.label}
                  <span style={{ opacity: sort?.key === col.key ? 1 : 0.3, marginLeft: 4 }}>
                    {sort?.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </th>
              ) : (
                <th key={`static-${idx}`}>{col.label}</th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const rank = rankLabel(row, rankIndex.get(row.vendorId) ?? 0);
            return (
              <tr key={row.vendorId}>
                <td>
                  <b>{row.name}</b>
                  {row.vendor.trades && row.vendor.trades.length > 0 && (
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {' '}
                      · {row.vendor.trades.join(', ')}
                    </span>
                  )}
                </td>
                <td>{row.open}</td>
                <td className={row.medianDaysOpen !== null && row.medianDaysOpen > 21 ? 'flag' : ''}>
                  {row.medianDaysOpen === null
                    ? '—'
                    : `${Math.round(row.medianDaysOpen)}d / ${Math.round(row.avgDaysOpen ?? 0)}d`}
                </td>
                <td className={row.overdue > 0 ? 'flag' : ''}>{row.overdue}</td>
                <td className={row.history && row.history.medianDays > 21 ? 'flag' : ''}>
                  {row.history
                    ? `${row.history.n} jobs · med ${row.history.medianDays}d → p90 ${row.history.p90Days}d · ${row.history.pctOver30}% >30d`
                    : '—'}
                </td>
                <td className={row.avgAcceptHours !== null && row.avgAcceptHours > 24 ? 'flag' : 'ok'}>
                  {acceptTime(row.avgAcceptHours)}
                </td>
                <td className={row.callbackRate > 0.05 ? 'warn' : 'ok'}>
                  {row.assignments90d === 0 ? '—' : `${Math.round(row.callbackRate * 100)}%`}
                </td>
                <td>{row.score === null ? '—' : row.score.toFixed(2)}</td>
                <td className={rank.cls}>{rank.text}</td>
                <td>
                  {row.vendor.appfolio_vendor_id ? (
                    <a
                      href={vendorAppfolioUrl(row.vendor.appfolio_vendor_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mo-btn secondary"
                      style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
                      title="Insurance, license & W-9 live in AppFolio — view / edit there"
                    >
                      AppFolio ↗
                    </a>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>—</span>
                  )}
                </td>
                <td>
                  <button className="mo-btn secondary" onClick={() => onEdit(row)}>
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
          {scoreboard.length === 0 && (
            <tr>
              <td colSpan={11} style={{ color: 'var(--muted)' }}>
                No vendors yet — the AppFolio sync seeds the roster; profiles are filled in here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="note">
        Two windows: <b>History (all-time)</b> is seeded from the closed-WO mirror (created →
        completed cycle time; jobs missing either date are excluded) so rankings mean something
        on day one. <b>Accept time / callback (90d)</b> build up from live assignments and take
        over as the operative signal. Red flag = median over 21 days. The ranking drives
        dispatch — repeat offenders demote themselves at Monday review.
      </p>
    </section>
  );
}
