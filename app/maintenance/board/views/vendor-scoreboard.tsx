'use client';

import { useState } from 'react';
import type { ScoreboardRow } from '../board-types';
import { fmtDate } from '../board-types';

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
    license_number: v.license_number ?? '',
    license_expiry: v.license_expiry ?? '',
    license_required_trades: (v.license_required_trades ?? []).join(', '),
    insurance_carrier: v.insurance_carrier ?? '',
    insurance_expiry: v.insurance_expiry ?? '',
    w9_on_file: v.w9_on_file,
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
          license_number: fields.license_number || null,
          license_expiry: fields.license_expiry || null,
          license_required_trades: csv(fields.license_required_trades),
          insurance_carrier: fields.insurance_carrier || null,
          insurance_expiry: fields.insurance_expiry || null,
          w9_on_file: fields.w9_on_file,
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
        {text('License #', 'license_number')}
        {text('License expiry', 'license_expiry', 'date')}
        {text('License-required trades', 'license_required_trades')}
        {text('Insurance carrier', 'insurance_carrier')}
        {text('Insurance expiry', 'insurance_expiry', 'date')}
        {text('Minimum charge', 'minimum_charge', 'number')}
        {text('Property restrictions', 'property_restrictions')}
        {text('Notes', 'notes')}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        {check('W-9 on file', 'w9_on_file')}
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

export default function VendorScoreboard({
  scoreboard,
  onRefresh,
}: {
  scoreboard: ScoreboardRow[];
  onRefresh?: () => void;
}) {
  const [editing, setEditing] = useState<ScoreboardRow | null>(null);
  const onEdit = (row: ScoreboardRow) => setEditing(row);

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
            <th>Vendor / Tech</th>
            <th>Open</th>
            <th>Avg days open</th>
            <th>Overdue</th>
            <th>Accept time</th>
            <th>Callback rate</th>
            <th>Insurance</th>
            <th>Score</th>
            <th>Rank</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {scoreboard.map((row, i) => {
            const rank = rankLabel(row, i);
            const insuranceExpired =
              row.vendor.insurance_expiry && row.vendor.insurance_expiry < new Date().toISOString().slice(0, 10);
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
                <td className={row.avgDaysOpen && row.avgDaysOpen > 10 ? 'flag' : ''}>
                  {row.avgDaysOpen === null ? '—' : row.avgDaysOpen.toFixed(1)}
                </td>
                <td className={row.overdue > 0 ? 'flag' : ''}>{row.overdue}</td>
                <td className={row.avgAcceptHours !== null && row.avgAcceptHours > 24 ? 'flag' : 'ok'}>
                  {acceptTime(row.avgAcceptHours)}
                </td>
                <td className={row.callbackRate > 0.05 ? 'warn' : 'ok'}>
                  {row.assignments90d === 0 ? '—' : `${Math.round(row.callbackRate * 100)}%`}
                </td>
                <td className={insuranceExpired ? 'flag' : row.vendor.insurance_expiry ? 'ok' : 'warn'}>
                  {row.vendor.insurance_expiry
                    ? `exp ${fmtDate(row.vendor.insurance_expiry)}/${row.vendor.insurance_expiry.slice(0, 4)}${insuranceExpired ? ' ⚠' : ''}`
                    : 'not on file'}
                </td>
                <td>{row.score.toFixed(2)}</td>
                <td className={rank.cls}>{rank.text}</td>
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
              <td colSpan={10} style={{ color: 'var(--muted)' }}>
                No vendors yet — the AppFolio sync seeds the roster; profiles are filled in here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="note">
        Backed by vendor profiles: trade, service area, licensing, insurance, rates, minimums,
        emergency availability, property restrictions. The ranking drives dispatch — repeat
        offenders demote themselves at Monday review.
      </p>
    </section>
  );
}
