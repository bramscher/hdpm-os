'use client';

import { useState } from 'react';

/**
 * IDS solve with a forced outcome (Brief 2D, doc 06 §4): a decision
 * and/or one or more to-dos. Shared by the Issues board and the meeting
 * runner. POSTs /api/eos/issues/:id/solve.
 */
interface Props {
  issueId: string;
  issueTitle: string;
  staff: string[];
  meetingId?: string;
  onSolved: () => void;
  onCancel: () => void;
}

export default function SolveOutcomeForm({
  issueId,
  issueTitle,
  staff,
  meetingId,
  onSolved,
  onCancel,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisionTitle, setDecisionTitle] = useState('');
  const [decisionStatement, setDecisionStatement] = useState('');
  const [todos, setTodos] = useState<{ title: string; owner: string; dueOn: string }[]>([
    { title: '', owner: '', dueOn: '' },
  ]);

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { meetingId };
    if (decisionTitle.trim() || decisionStatement.trim()) {
      body.decision = { title: decisionTitle, statementMd: decisionStatement };
    }
    const filledTodos = todos
      .filter((t) => t.title.trim())
      .map((t) => ({
        title: t.title,
        ownerPerson: t.owner || undefined,
        dueOn: t.dueOn || undefined,
      }));
    if (filledTodos.length > 0) body.todos = filledTodos;
    try {
      const res = await fetch(`/api/eos/issues/${issueId}/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Solve failed (${res.status})`);
        return;
      }
      onSolved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-green-200 bg-green-50/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-green-800">
        Solve: {issueTitle}
      </p>
      <p className="text-xs text-charcoal-500">
        No outcome, no &ldquo;solved&rdquo; — record a decision, hand out to-dos, or both.
      </p>
      {error ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          {error}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-charcoal-700">Decision (optional)</p>
        <input
          className="w-full rounded border border-sand-300 px-2 py-1.5 text-sm"
          placeholder="Decision title"
          value={decisionTitle}
          onChange={(e) => setDecisionTitle(e.target.value)}
        />
        <textarea
          className="w-full rounded border border-sand-300 px-2 py-1.5 text-sm"
          placeholder="What was decided, in a sentence or two"
          rows={2}
          value={decisionStatement}
          onChange={(e) => setDecisionStatement(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-charcoal-700">To-dos (optional)</p>
        {todos.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className="min-w-0 flex-1 rounded border border-sand-300 px-2 py-1 text-sm"
              placeholder="To-do"
              value={t.title}
              onChange={(e) =>
                setTodos((list) => list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
              }
            />
            <select
              className="rounded border border-sand-300 px-1 py-1 text-xs text-charcoal-600"
              value={t.owner}
              onChange={(e) =>
                setTodos((list) => list.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)))
              }
            >
              <option value="">Owner</option>
              {staff.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="rounded border border-sand-300 px-1 py-1 text-xs text-charcoal-600"
              value={t.dueOn}
              onChange={(e) =>
                setTodos((list) => list.map((x, j) => (j === i ? { ...x, dueOn: e.target.value } : x)))
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="text-xs text-charcoal-500 hover:text-charcoal-700"
          onClick={() => setTodos((list) => [...list, { title: '', owner: '', dueOn: '' }])}
        >
          + another to-do
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="rounded bg-green-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Record outcome & solve
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-sand-300 px-3 py-1 text-xs text-charcoal-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
