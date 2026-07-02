'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import type { ExceptionsData } from '../board-types';

interface Recipient {
  person: string;
  email: string | null;
  enabled: boolean;
}

/** Admin-only opt-in editor: who receives the daily tripwire digest emails. */
function DigestRecipientsPanel() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/maintenance/digest-recipients')
      .then((res) => (res.ok ? res.json() : { recipients: [] }))
      .then((body) => setRecipients(body.recipients ?? []));
  }, []);

  async function save(person: string, email: string | null, enabled: boolean) {
    setSaving(person);
    setError(null);
    try {
      const res = await fetch('/api/maintenance/digest-recipients', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person, email, enabled }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `Save failed (${res.status})`);
        return;
      }
      setRecipients((rows) =>
        rows.map((r) => (r.person === person ? { ...r, ...body.recipient } : r))
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mo-panel" style={{ marginBottom: 14 }}>
      <h2 style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        Digest recipients (daily 6AM email per owner) {open ? '▾' : '▸'}
      </h2>
      {open && (
        <>
          {error && <p className="note flag">{error}</p>}
          <table className="mo-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Email</th>
                <th>Receives digests</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.person}>
                  <td style={{ fontWeight: 700 }}>{r.person}</td>
                  <td>
                    <input
                      className="mo-input"
                      type="email"
                      placeholder="name@highdesertpm.com"
                      value={drafts[r.person] ?? r.email ?? ''}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [r.person]: e.target.value }))
                      }
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val !== (r.email ?? '')) save(r.person, val || null, r.enabled && !!val);
                      }}
                      disabled={saving === r.person}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      disabled={saving === r.person || !(drafts[r.person] ?? r.email)}
                      onChange={(e) =>
                        save(r.person, drafts[r.person] ?? r.email, e.target.checked)
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            Each person gets one email per day listing only THEIR exceptions — nothing on a clean
            day. Opt-in requires an email. (Emails send once RESEND_API_KEY is configured.)
          </p>
        </>
      )}
    </div>
  );
}

export default function Exceptions({ data }: { data: ExceptionsData | null }) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin === true;

  if (!data) {
    return (
      <section>
        {isAdmin && <DigestRecipientsPanel />}
        <p className="note">Running the 12 tripwire rules…</p>
      </section>
    );
  }

  return (
    <section>
      {isAdmin && <DigestRecipientsPanel />}
      {data.exceptions.length === 0 ? (
        <div className="kpis">
          <div className="kpi">
            <div className="v ok">ZERO</div>
            <div className="l">
              Exceptions — the sweep is done. Five consecutive business days at zero = Phase-1
              definition of done.
            </div>
          </div>
        </div>
      ) : (
        <table className="mo-table">
          <thead>
            <tr>
              <th>Tripwire</th>
              <th>Item</th>
              <th>Fix required today</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {data.exceptions.map((ex, i) => (
              <tr key={i}>
                <td className="flag" style={{ whiteSpace: 'nowrap' }}>
                  {ex.label}
                </td>
                <td>
                  {ex.workOrderId ? (
                    <Link href={`/maintenance/board/wo/${ex.workOrderId}`}>{ex.item}</Link>
                  ) : (
                    ex.item
                  )}
                </td>
                <td>{ex.fixRequired}</td>
                <td>{ex.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.ruleErrors.length > 0 && (
        <p className="note flag">
          Rule errors: {data.ruleErrors.map((e) => `#${e.tripwire}: ${e.error}`).join(' · ')}
        </p>
      )}

      <p className="note">
        The daily sweep ends when this view reads ZERO — every exception gets an owner and a date,
        or gets escalated. Tripwires #1 and #9 await the Haven.AI integration.
      </p>
    </section>
  );
}
