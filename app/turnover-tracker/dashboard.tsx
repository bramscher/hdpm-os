'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { SECTIONS, SECTION_STATUS_LABEL, VIEW_LABEL, type SectionStatus, type TurnView } from '@/lib/turnover/model';
import type { Dashboard } from '@/lib/turnover/server';
import { SECTION_KEY_ORDER, SectionPill, shortDate } from './pills';

const select = 'h-10 rounded-lg border border-sand-200 bg-white px-3 text-sm text-charcoal-800';

export function TurnoverDashboard({ data, view }: { data: Dashboard; view: TurnView }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [property, setProperty] = useState('');
  const [coordinator, setCoordinator] = useState('');
  const [status, setStatus] = useState<SectionStatus | ''>('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.rows.filter(
      (r) =>
        (!q || `${r.unit} ${r.property}`.toLowerCase().includes(q)) &&
        (!property || r.property === property) &&
        (!coordinator || r.coordinator === coordinator) &&
        (!status || r.sections.some((s) => s.status === status))
    );
  }, [data.rows, search, property, coordinator, status]);

  const viewNote: Record<TurnView, string> = {
    active: 'Active: not marked complete, on or after the AppFolio move-out date.',
    not_yet_ready: 'Not yet ready: not marked complete, move-out date still in the future.',
    completed: 'Completed: unit turns marked complete.',
    all: 'All unit turns.',
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-charcoal-900">
            Unit turnovers <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-xs font-medium text-amber-800">Test</span>
          </h1>
          <p className="mt-1 text-sm text-charcoal-500">{viewNote[view]} Data syncs from AppFolio; nothing is written back.</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [data.tiles.units, 'Units in turnover'],
          [data.tiles.waitingApproval, 'Waiting on owner approval'],
          [data.tiles.waitingFunds, 'Waiting on funding'],
          [data.tiles.needsAction, 'Items overdue or needing action'],
        ].map(([n, label]) => (
          <div key={label} className="rounded-xl border border-sand-200 bg-white p-4">
            <div className={`text-2xl font-semibold ${label === 'Items overdue or needing action' && Number(n) > 0 ? 'text-red-700' : 'text-charcoal-900'}`}>{n}</div>
            <div className="text-sm text-charcoal-500">{label}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className={`${select} min-w-[220px] flex-1`} placeholder="Search unit or address" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={select} value={property} onChange={(e) => setProperty(e.target.value)} aria-label="Property">
          <option value="">All properties</option>
          {data.properties.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className={select} value={coordinator} onChange={(e) => setCoordinator(e.target.value)} aria-label="Coordinator">
          <option value="">All coordinators</option>
          {data.coordinators.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className={select} value={status} onChange={(e) => setStatus(e.target.value as SectionStatus | '')} aria-label="Status">
          <option value="">Any status</option>
          {SECTION_KEY_ORDER.map((s) => <option key={s} value={s}>{SECTION_STATUS_LABEL[s]}</option>)}
        </select>
        <div className="flex rounded-lg bg-sand-100 p-1">
          {(Object.keys(VIEW_LABEL) as TurnView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => router.push(v === 'active' ? '/turnover-tracker' : `/turnover-tracker?view=${v}`)}
              className={`rounded-md px-3 py-1.5 text-sm ${v === view ? 'bg-charcoal-900 text-white' : 'text-charcoal-700 hover:bg-white'}`}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-sand-50 text-xs text-charcoal-700">
            <tr className="align-top">
              <th className="sticky left-0 bg-sand-50 px-4 py-3 align-top font-bold">Unit</th>
              <th className="px-3 py-3 align-top font-bold">Move-out</th>
              <th className="px-3 py-3 align-top font-bold">Move-in</th>
              {SECTIONS.map((s) => <th key={s.no} className="px-3 py-3 align-top font-bold">{s.short}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-charcoal-500">No unit turns in this view.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer align-top hover:bg-sand-50" onClick={() => router.push(`/turnover-tracker/${r.id}`)}>
                <td className="sticky left-0 bg-white px-4 py-3">
                  <Link href={`/turnover-tracker/${r.id}`} className="font-semibold text-charcoal-900 hover:underline" onClick={(e) => e.stopPropagation()}>{r.unit}</Link>
                  <div className="text-xs text-charcoal-500">{r.unit !== r.property ? r.property : ''}</div>
                  {r.coordinator && <div className="text-xs text-charcoal-400">{r.coordinator}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-3">{shortDate(r.vacated_at)}</td>
                <td className="whitespace-nowrap px-3 py-3">{shortDate(r.movein_date)}</td>
                {r.sections.map((s) => (
                  <td key={s.no} className="px-3 py-3">
                    <SectionPill status={s.status} />
                    {s.detail && <div className={`mt-1 text-xs ${s.overdue ? 'font-medium text-red-700' : 'text-charcoal-500'}`}>{s.detail}</div>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-charcoal-500">
        <span>Category status key (rolled up from each category&apos;s work orders and checklist; work order statuses are on the unit page):</span>
        {SECTION_KEY_ORDER.map((s) => <SectionPill key={s} status={s} />)}
      </div>
    </div>
  );
}
