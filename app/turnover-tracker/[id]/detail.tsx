'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SECTIONS, WO_STATUSES, WO_STATUS_LABEL, type CheckDef, type CheckState, type WoStatus } from '@/lib/turnover/model';
import type { Detail, DetailWo } from '@/lib/turnover/server';
import { SectionPill, WO_TONE, shortDate } from '../pills';

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);
const card = 'rounded-xl border border-sand-200 bg-white';

export function TurnDetail({ detail }: { detail: Detail }) {
  const router = useRouter();
  const { turn } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function post(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Update failed');
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
      return false;
    } finally {
      setBusy(false);
    }
  }
  const act = (body: Record<string, unknown>) => post(`/api/turnover-tracker/${turn.id}`, body);
  const setWo = (woId: string, status: WoStatus) => post(`/api/turnover-tracker/work-orders/${woId}`, { status });

  const closed = turn.status === 'closed';
  const slipOverdue = detail.needsAction.includes('Deposit slip overdue');

  return (
    <div>
      <header className="bg-charcoal-900 px-4 py-5 text-white sm:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-4">
          <div>
            <Link href="/turnover-tracker" className="text-xs text-white/70 hover:text-white">← Back to all turnovers</Link>
            <h1 className="mt-1 text-2xl font-semibold">{turn.unit_name ? `${turn.unit_name}, ${turn.property_name}` : turn.property_name}</h1>
            <p className="text-xs text-white/60">Shows from the AppFolio move-out date until the turn is marked complete{closed ? ' · Marked complete' : ''}</p>
          </div>
          <dl className="flex flex-wrap gap-6 text-sm">
            {[
              ['Move-out', shortDate(turn.vacated_at)],
              ['New move-in', shortDate(turn.movein_date)],
              ['Target turnaround', shortDate(turn.target_ready)],
              ['Deposit slip due', `${shortDate(turn.deposit_due)} (30 days)`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-white/60">{k}</dt>
                <dd className={`font-semibold ${k === 'Deposit slip due' && slipOverdue ? 'text-red-300' : ''}`}>{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-white/60">Coordinator</dt>
              <dd>
                <select
                  className="rounded bg-white/10 px-2 py-0.5 font-semibold text-white"
                  value={turn.coordinator ?? ''}
                  disabled={busy}
                  onChange={(e) => act({ action: 'coordinator', person: e.target.value })}
                >
                  {!turn.coordinator && <option value="">Not set</option>}
                  {detail.staff.map((s) => <option key={s.person} value={s.person} className="text-charcoal-900">{s.name}</option>)}
                </select>
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}

          <section className={`${card} p-4`}>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-charcoal-800">Overall progress</span>
              <div className="h-2 flex-1 rounded-full bg-sand-100">
                <div className="h-2 rounded-full bg-green-600" style={{ width: `${(detail.progress.complete / detail.progress.total) * 100}%` }} />
              </div>
              <span className="text-sm text-charcoal-500">{detail.progress.complete} of {detail.progress.total} categories complete</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="mr-1 font-medium text-charcoal-700">Work order statuses</span>
              {WO_STATUSES.map((s) => <span key={s} className={`rounded-full px-2 py-0.5 ${WO_TONE[s]}`}>{WO_STATUS_LABEL[s]}</span>)}
            </div>
            <p className="mt-2 text-xs text-charcoal-500">Statuses sync from AppFolio. Any status can be changed by hand; the most recent change, from AppFolio or manual, is the one that shows.</p>
          </section>

          {detail.sections.map((s) => {
            const meta = SECTIONS.find((x) => x.no === s.no)!;
            const wos = s.woIds.map((id) => detail.wos[id]);
            return (
              <section key={s.no} className={card}>
                <div className="flex items-start justify-between gap-3 border-b border-sand-100 px-4 py-3">
                  <div>
                    <h2 className="font-semibold text-charcoal-900">{s.no}. {meta.title}</h2>
                    <p className="text-xs text-charcoal-500">{meta.source}</p>
                  </div>
                  <SectionPill status={s.status} />
                </div>
                {s.checks.length > 0 && (
                  <ul className="divide-y divide-sand-100">
                    {s.checks.map((c) => (
                      <CheckRow
                        key={c.def.key}
                        def={c.def}
                        checked={c.checked}
                        state={c.state}
                        disabled={busy}
                        due={c.def.key === 'deposit_slip_sent' ? { date: turn.deposit_due, overdue: slipOverdue } : undefined}
                        moveIn={c.def.key === 'movein_entered' ? turn.movein_date : undefined}
                        onSave={(checked, value) => act({ action: 'check', key: c.def.key, checked, value })}
                      />
                    ))}
                  </ul>
                )}
                {wos.length > 0 && <WoTable wos={wos} disabled={busy} onStatus={setWo} />}
                {s.no === 4 && (
                  <p className="mx-4 mb-4 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-900">
                    The follow-up inspection cannot be checked early and does not change any other work order. When it is completed it defaults to Complete, no bill needed; change it if an invoice arrives.
                  </p>
                )}
                {s.checks.length === 0 && wos.length === 0 && <p className="px-4 py-3 text-sm text-charcoal-500">No work orders in this category.</p>}
              </section>
            );
          })}
        </div>

        <aside className="min-w-0 space-y-5">
          <section className={`${card} p-4`}>
            <h2 className="font-semibold text-charcoal-900">{closed ? 'Marked complete' : 'Close out'}</h2>
            <p className="mt-1 text-xs text-charcoal-500">
              {closed ? 'This turn is marked complete and has left the Active view.' : 'Complete when all 7 categories are done, or mark it complete now.'}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => act({ action: closed ? 'reopen' : 'complete' })}
              className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-medium ${closed ? 'border border-sand-200 text-charcoal-800' : 'bg-charcoal-900 text-white'} disabled:opacity-50`}
            >
              {closed ? 'Reopen turn' : 'Mark complete'}
            </button>
          </section>

          <section className={`${card} p-4`}>
            <h2 className="font-semibold text-charcoal-900">From AppFolio</h2>
            <p className="text-xs text-charcoal-500">Read-only, refreshed on sync</p>
            <dl className="mt-3 space-y-2 text-sm">
              {[
                ['Property', turn.property_name],
                ['Unit', turn.unit_name ?? '—'],
                ['Move-out date', shortDate(turn.vacated_at)],
                ['New move-in date', shortDate(turn.movein_date)],
                ['Target turnaround', shortDate(turn.target_ready)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="shrink-0 text-charcoal-500">{k}</dt>
                  <dd className="min-w-0 break-words text-right font-medium text-charcoal-900">{v}</dd>
                </div>
              ))}
            </dl>
            {turn.af_unit_link && (
              <a href={turn.af_unit_link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-blue-700 hover:underline">Open in AppFolio ↗</a>
            )}
          </section>

          <section className={`${card} p-4 text-xs text-charcoal-600`}>
            <h2 className="mb-2 text-sm font-semibold text-charcoal-900">Reminder rules</h2>
            <ul className="space-y-2">
              <li>Tasks are created on weekdays at 7am Pacific for every work order not yet Scheduled, Complete or Cancelled.</li>
              <li>Recipients: the unit turn coordinator and any employee assigned to the work order in AppFolio. One task if they are the same person.</li>
              <li>Estimate requested, Estimated and awaiting owner approval link to the estimate follow-up board instead of a second reminder.</li>
              <li>Completed, awaiting invoice reminds after 5 business days.</li>
              <li>Vendors never receive reminders. A reminder can be snoozed until a chosen date.</li>
              <li className="italic text-charcoal-400">Reminder tasks arrive in the next build; the Reminder column shows what each work order will get.</li>
            </ul>
          </section>

          <section className={`${card} p-4`}>
            <h2 className="font-semibold text-charcoal-900">Notes and activity</h2>
            <textarea
              rows={3}
              className="mt-2 w-full rounded-lg border border-sand-200 px-3 py-2 text-sm"
              placeholder="Add a note for the team"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={async () => { if (await act({ action: 'note', body: note })) setNote(''); }}
              className="mt-2 rounded-lg bg-charcoal-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Add note
            </button>
            <ul className="mt-4 space-y-3 text-sm">
              {detail.activity.length === 0 && <li className="text-xs text-charcoal-400">No activity yet.</li>}
              {detail.activity.map((a) => (
                <li key={a.id} className="border-t border-sand-100 pt-2">
                  <div className={`whitespace-pre-line ${a.kind === 'note' ? 'text-charcoal-900' : 'text-charcoal-600'}`}>{a.body}</div>
                  <div className="text-xs text-charcoal-400">{a.actor}, {new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function CheckRow({
  def, checked, state, disabled, due, moveIn, onSave,
}: {
  def: CheckDef;
  checked: boolean;
  state?: CheckState;
  disabled: boolean;
  due?: { date: string; overdue: boolean };
  moveIn?: string | null;
  onSave: (checked: boolean, value: string | null) => void;
}) {
  const [value, setValue] = useState(state?.value ?? '');
  const computed = def.kind === 'computed';
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
      <label className="flex flex-1 items-center gap-2.5">
        <input type="checkbox" className="h-4 w-4" checked={checked} disabled={disabled || computed} onChange={(e) => onSave(e.target.checked, value || null)} />
        <span className={computed ? 'text-charcoal-600' : 'text-charcoal-900'}>{def.label}</span>
      </label>
      {def.value && (
        <input
          type={def.value.type === 'date' ? 'date' : def.value.type === 'url' ? 'url' : 'text'}
          placeholder={def.value.label}
          aria-label={def.value.label}
          className="h-8 w-44 rounded-md border border-sand-200 px-2 text-sm"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => { if (value !== (state?.value ?? '')) onSave(checked || !!value, value || null); }}
        />
      )}
      <span className={`text-xs ${due?.overdue && !checked ? 'font-medium text-red-700' : 'text-charcoal-500'}`}>
        {due ? `Due ${shortDate(due.date)}, 30 days from move-out` : moveIn !== undefined ? (moveIn ? shortDate(moveIn) : 'Not entered in AppFolio') : def.hint ?? (state?.checked_at ? `${shortDate(state.checked_at)}${state.checked_by ? ` · ${state.checked_by}` : ''}` : '')}
      </span>
    </li>
  );
}

function WoTable({ wos, disabled, onStatus }: { wos: DetailWo[]; disabled: boolean; onStatus: (id: string, s: WoStatus) => void }) {
  return (
    <ul className="divide-y divide-sand-100 border-t border-sand-100">
      {wos.map((w) => <WoRow key={w.id} w={w} disabled={disabled} onStatus={onStatus} />)}
    </ul>
  );
}

/** One work order: title + status on top, its facts in a wrapping grid underneath — no sideways scroll. */
function WoRow({ w, disabled, onStatus }: { w: DetailWo; disabled: boolean; onStatus: (id: string, s: WoStatus) => void }) {
  const [open, setOpen] = useState(false);
  const long = w.title.length > 140;
  const facts: [string, string][] = [
    ['Vendor', w.vendor ?? '—'],
    ['Assigned employee', w.assigned ?? '—'],
    ['Estimate', money(w.estimate)],
    ['Approved', w.approved != null ? money(w.approved) : w.estimate != null ? 'Pending' : '—'],
    ['Scheduled', w.scheduled ? shortDate(w.scheduled) : 'Not set'],
    ['Done', w.done ? shortDate(w.done) : 'None'],
    ['Invoice', w.invoice],
    ['Reminder task', w.reminder],
  ];
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <div className={`whitespace-pre-line font-medium text-charcoal-900 ${long && !open ? 'line-clamp-2' : ''}`}>{w.title}</div>
          <div className="mt-0.5 text-xs text-charcoal-500">
            {w.category}{w.wo_number ? ` · WO ${w.wo_number}` : ''}
            {w.appfolio_link && <> · <a href={w.appfolio_link} target="_blank" rel="noopener noreferrer" className="text-blue-700">AF↗</a></>}
            {long && <> · <button type="button" className="text-blue-700" onClick={() => setOpen(!open)}>{open ? 'Less' : 'More'}</button></>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <select
            className={`max-w-[260px] rounded-full border-0 px-2.5 py-1 text-xs font-medium ${WO_TONE[w.status]}`}
            value={w.status}
            disabled={disabled}
            onChange={(e) => onStatus(w.id, e.target.value as WoStatus)}
            aria-label="Change status"
          >
            {WO_STATUSES.map((s) => <option key={s} value={s}>{WO_STATUS_LABEL[s]}</option>)}
          </select>
          <div className="mt-1 text-xs text-charcoal-500">
            {w.source === 'manual' ? `Manual${w.sourceBy ? ` (${w.sourceBy})` : ''}` : 'AppFolio'}
            {w.daysInStatus != null ? `, ${w.daysInStatus} day${w.daysInStatus === 1 ? '' : 's'}` : ''}
          </div>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4 xl:grid-cols-8">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] font-bold text-charcoal-500">{k}</dt>
            <dd className="truncate text-charcoal-900" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
