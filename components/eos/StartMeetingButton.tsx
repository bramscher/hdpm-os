'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Creates this week's meeting and jumps into the runner (Brief 2D). */
export default function StartMeetingButton({ kind = 'L10' }: { kind?: 'L10' | 'huddle' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/eos/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Failed (${res.status})`);
        return;
      }
      router.push(`/company/meetings/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="rounded-lg bg-terra-500 hover:bg-terra-600 transition-colors px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        Start this week&rsquo;s {kind}
      </button>
      {error ? <span className="ml-2 text-xs text-amber-700">{error}</span> : null}
    </span>
  );
}
