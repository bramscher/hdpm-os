'use client';

import { useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

type Props = {
  value: string;
  context: 'estimate' | 'invoice' | 'work-order';
  disabled?: boolean;
  onApply: (text: string) => void;
};

export default function ImproveWithAI({ value, context, disabled, onApply }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState<{ original: string; text: string } | null>(null);
  const current = useRef(value);
  current.current = value;
  const pending = useRef(false);
  async function improve() {
    if (pending.current || disabled || !value.trim()) return;
    const original = value;
    pending.current = true;
    setBusy(true); setError(''); setSuggestion(null);
    try {
      const response = await fetch('/api/maintenance/improve-copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: original, context }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not improve text. Try again.');
      if (current.current !== original) throw new Error('Text changed while AI was working. Click Improve with AI again.');
      if (typeof data.rewritten !== 'string' || !data.rewritten.trim()) throw new Error('No suggestion returned. Try again.');
      setSuggestion({ original, text: data.rewritten });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not improve text. Try again.'); }
    finally { setBusy(false); pending.current = false; }
  }
  const stale = suggestion !== null && suggestion.original !== value;
  return <div className="mt-1 text-xs">
    <button type="button" title="Improve capitalization, grammar, and consistency" disabled={disabled || busy || !value.trim()} onClick={() => void improve()}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-purple-700 hover:bg-purple-50 disabled:opacity-40">
      {busy ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin"/> : <Sparkles aria-hidden="true" className="h-3.5 w-3.5"/>}
      {busy ? 'Improving…' : 'Improve with AI'}
    </button>
    {error && <p role="alert" className="mt-1 text-red-700">{error}</p>}
    {suggestion && <div aria-label="AI copy suggestion" className="mt-2 space-y-2 rounded-lg border border-purple-200 bg-purple-50 p-3">
      <p className="font-medium">Review suggestion</p>
      <p className="whitespace-pre-wrap text-charcoal-700">{suggestion.text}</p>
      <p className="text-charcoal-500">Check scope and facts before applying. Prices and quantities in other fields stay unchanged.</p>
      {stale && <p role="status" className="text-amber-800">Your text has changed. Generate a new suggestion.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || stale} className="rounded border border-purple-300 bg-white px-3 py-2 disabled:opacity-40" onClick={() => {
          if (current.current !== suggestion.original) return;
          onApply(suggestion.text); setSuggestion(null);
        }}>Use suggestion</button>
        <button type="button" className="rounded px-3 py-2" onClick={() => setSuggestion(null)}>Keep original</button>
      </div>
    </div>}
  </div>;
}
