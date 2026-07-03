'use client';

/**
 * AI Next Action Panel — per-work-order Claude triage.
 * Summary · priority recommendation · risk flags · blocker · next action ·
 * draft message (copy-paste) · AppFolio update checklist.
 * Advisory only: a human applies the checklist in AppFolio.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AiTriage } from '@/lib/maintenance/ai-triage';
import { WaitBadge } from '../../components/shared';
import type { WaitingReason } from '@/lib/maintenance/types';

const PRIORITY_CLASS: Record<AiTriage['priority']['recommended'], string> = {
  P1: 'flag',
  P2: 'warn',
  P3: 'ok',
  P4: '',
};

export default function AiTriagePanel({ workOrderId }: { workOrderId: string }) {
  const [triage, setTriage] = useState<AiTriage | null>(null);
  const [meta, setMeta] = useState<{ at: string | null; by: string | null }>({ at: null, by: null });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadCached = useCallback(async () => {
    const res = await fetch(`/api/maintenance/work-orders/${workOrderId}/ai-triage`);
    if (!res.ok) return;
    const body = await res.json();
    if (body.triage) {
      setTriage(body.triage);
      setMeta({ at: body.generatedAt, by: body.generatedBy });
    }
  }, [workOrderId]);

  useEffect(() => {
    loadCached();
  }, [loadCached]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/maintenance/work-orders/${workOrderId}/ai-triage`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `Generation failed (${res.status})`);
        return;
      }
      setTriage(body.triage);
      setMeta({ at: body.generatedAt, by: body.generatedBy });
    } finally {
      setGenerating(false);
    }
  }

  async function copyDraft() {
    if (!triage) return;
    await navigator.clipboard.writeText(
      `Subject: ${triage.draft_message.subject}\n\n${triage.draft_message.body}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mo-panel" style={{ marginBottom: 14, borderLeft: '4px solid var(--gr)' }}>
      <h2 style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        ✦ AI Next Action
        <button className="mo-btn secondary" disabled={generating} onClick={generate}>
          {generating ? 'Thinking…' : triage ? 'Regenerate' : 'Generate'}
        </button>
        {meta.at && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
            {new Date(meta.at).toLocaleString()} · requested by {meta.by}
          </span>
        )}
      </h2>

      {error && <p className="note flag">{error}</p>}

      {!triage && !generating && !error && (
        <p className="note" style={{ borderTop: 'none', marginTop: 0 }}>
          Generates a summary, priority recommendation, risk flags, next action, a draft message,
          and an AppFolio checklist from this work order&apos;s data. Advisory only — nothing is
          written to AppFolio.
        </p>
      )}

      {triage && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 13 }}>
          <div>
            <p className="mo-field-label">Summary</p>
            <p>{triage.summary}</p>

            <p className="mo-field-label" style={{ marginTop: 10 }}>
              Priority
            </p>
            <p>
              <b className={PRIORITY_CLASS[triage.priority.recommended]}>
                {triage.priority.recommended}
              </b>{' '}
              — {triage.priority.rationale}
            </p>
            {triage.priority.escalate_if.length > 0 && (
              <p style={{ color: 'var(--amber)' }}>
                Escalate if: {triage.priority.escalate_if.join(' · ')}
              </p>
            )}

            {triage.risk_flags.length > 0 && (
              <>
                <p className="mo-field-label" style={{ marginTop: 10 }}>
                  Risk flags
                </p>
                <ul style={{ listStyle: 'disc', paddingLeft: 18 }}>
                  {triage.risk_flags.map((r, i) => (
                    <li key={i} className="flag" style={{ fontWeight: 400 }}>
                      {r}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="mo-field-label" style={{ marginTop: 10 }}>
              Blocker
            </p>
            <p>
              {triage.blocker.classification === 'NONE' ? (
                <span className="ok">none</span>
              ) : (
                <WaitBadge reason={triage.blocker.classification as WaitingReason} small />
              )}{' '}
              {triage.blocker.detail}
            </p>

            <p className="mo-field-label" style={{ marginTop: 10 }}>
              Recommended next action
            </p>
            <p style={{ fontWeight: 700 }}>{triage.next_action}</p>
          </div>

          <div>
            <p className="mo-field-label">
              Draft message → {triage.draft_message.audience}{' '}
              <button className="mo-btn secondary" onClick={copyDraft} style={{ marginLeft: 6 }}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </p>
            <div
              style={{
                border: '1px solid var(--hair)',
                borderRadius: 6,
                padding: 10,
                background: 'var(--lt)',
                whiteSpace: 'pre-wrap',
              }}
            >
              <b>{triage.draft_message.subject}</b>
              {'\n\n'}
              {triage.draft_message.body}
            </div>

            <p className="mo-field-label" style={{ marginTop: 10 }}>
              AppFolio checklist (apply there — Open in AppFolio ↗)
            </p>
            <ol style={{ listStyle: 'decimal', paddingLeft: 18 }}>
              {triage.appfolio_checklist.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
