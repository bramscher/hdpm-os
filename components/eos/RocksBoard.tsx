'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { Rock, Seat } from '@/lib/eos/types';
import { cn } from '@/lib/utils';

interface Props {
  rocks: Rock[];
  seats: Seat[];
  staff: string[];
  quarter: string;
}

const STATUS_TONE: Record<Rock['status'], string> = {
  on: 'bg-green-50 text-green-800 border-green-200',
  off: 'bg-red-50 text-red-700 border-red-200',
  done: 'bg-gray-100 text-gray-600 border-gray-200',
  dropped: 'bg-gray-50 text-gray-400 border-gray-200',
};

const STATUS_LABEL: Record<Rock['status'], string> = {
  on: 'on track',
  off: 'off track',
  done: 'done',
  dropped: 'dropped',
};

export default function RocksBoard({ rocks, seats, staff, quarter }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ title: '', owner: '', dueOn: '' });

  const seatByPerson = new Map(seats.filter((s) => s.person).map((s) => [s.person as string, s.name]));
  const current = rocks.filter((r) => r.quarter === quarter);
  const past = rocks.filter((r) => r.quarter !== quarter);

  const byOwner = new Map<string, Rock[]>();
  for (const r of current) {
    const key = r.owner_person ?? 'Unassigned';
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key)!.push(r);
  }

  async function api(path: string, method: string, body: unknown, busyKey: string) {
    setBusy(busyKey);
    setNote(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNote(data.error ?? `Request failed (${res.status})`);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function createRock() {
    if (!draft.title.trim()) return;
    const ok = await api(
      '/api/eos/rocks',
      'POST',
      { title: draft.title, ownerPerson: draft.owner || undefined, dueOn: draft.dueOn || undefined },
      'new-rock'
    );
    if (ok) {
      setDraft({ title: '', owner: '', dueOn: '' });
      setShowForm(false);
    }
  }

  function StatusButtons({ rock }: { rock: Rock }) {
    const next: { status: Rock['status']; label: string }[] =
      rock.status === 'on' || rock.status === 'off'
        ? [
            { status: rock.status === 'on' ? 'off' : 'on', label: rock.status === 'on' ? 'Off track' : 'On track' },
            { status: 'done', label: 'Done' },
            { status: 'dropped', label: 'Drop' },
          ]
        : [{ status: 'on', label: 'Reactivate' }];
    return (
      <span className="flex gap-1">
        {next.map((n) => (
          <button
            key={n.status}
            type="button"
            onClick={() => void api(`/api/eos/rocks/${rock.id}`, 'PATCH', { status: n.status }, rock.id)}
            disabled={busy === rock.id}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:border-gray-400 disabled:opacity-50"
          >
            {n.label}
          </button>
        ))}
      </span>
    );
  }

  return (
    <div>
      {note ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {note}
        </div>
      ) : null}

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          {quarter} ({current.length} rocks)
        </h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 transition-colors hover:border-amber-400 hover:text-amber-700"
        >
          <Plus size={14} aria-hidden /> Rock
        </button>
      </div>

      {showForm ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
          <input
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="The rock — one important, finishable thing"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <select
            className="rounded border border-gray-300 px-1 py-1.5 text-xs text-gray-600"
            value={draft.owner}
            onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))}
          >
            <option value="">Owner…</option>
            {staff.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="rounded border border-gray-300 px-1 py-1.5 text-xs text-gray-600"
            value={draft.dueOn}
            onChange={(e) => setDraft((d) => ({ ...d, dueOn: e.target.value }))}
          />
          <button
            type="button"
            onClick={() => void createRock()}
            disabled={busy === 'new-rock' || !draft.title.trim()}
            className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>
      ) : null}

      {current.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          No rocks this quarter yet — 3–7 for the company, 1–3 per seat.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {[...byOwner.entries()].map(([owner, ownerRocks]) => (
            <div key={owner} className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="mb-2 text-sm font-semibold text-gray-900">
                {owner}
                {seatByPerson.has(owner) ? (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {seatByPerson.get(owner)}
                  </span>
                ) : null}
              </p>
              {ownerRocks.map((r) => (
                <div key={r.id} className="border-t border-gray-100 py-2 first:border-t-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-xs',
                        STATUS_TONE[r.status]
                      )}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{r.title}</span>
                    {r.due_on ? <span className="text-xs text-gray-400">{r.due_on}</span> : null}
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    {r.notes ? (
                      <span className="truncate text-xs text-gray-400">{r.notes}</span>
                    ) : (
                      <span />
                    )}
                    <StatusButtons rock={r} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {past.length > 0 ? (
        <details className="mt-6">
          <summary className="cursor-pointer text-xs text-gray-500">
            Past quarters ({past.length})
          </summary>
          <div className="mt-2 rounded-lg border border-gray-200 bg-white">
            {past.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0"
              >
                <span className="text-xs text-gray-400">{r.quarter}</span>
                <span className={cn('rounded-full border px-2 py-0.5 text-xs', STATUS_TONE[r.status])}>
                  {STATUS_LABEL[r.status]}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-700">{r.title}</span>
                <span className="text-xs text-gray-500">{r.owner_person ?? '—'}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
