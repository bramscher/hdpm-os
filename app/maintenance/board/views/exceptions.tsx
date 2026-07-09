'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import type { ExceptionsData } from '../board-types';
import type { TripwireException } from '@/lib/maintenance/types';

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
        Digest recipients (daily 6AM email per HDPM owner) {open ? '▾' : '▸'}
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

interface RuleGroup {
  tripwire: number;
  label: string;
  items: TripwireException[];
}

export default function Exceptions({ data }: { data: ExceptionsData | null }) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin === true;

  // Group exceptions by tripwire rule, biggest backlog first.
  const groups = useMemo<RuleGroup[]>(() => {
    const byRule = new Map<number, RuleGroup>();
    for (const ex of data?.exceptions ?? []) {
      let g = byRule.get(ex.tripwire);
      if (!g) {
        g = { tripwire: ex.tripwire, label: ex.label, items: [] };
        byRule.set(ex.tripwire, g);
      }
      g.items.push(ex);
    }
    return [...byRule.values()].sort(
      (a, b) => b.items.length - a.items.length || a.tripwire - b.tripwire,
    );
  }, [data]);

  // Collapsed by default so the by-rule counts read as a summary first.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (tw: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tw)) next.delete(tw);
      else next.add(tw);
      return next;
    });
  const expandAll = () => setExpanded(new Set(groups.map((g) => g.tripwire)));
  const collapseAll = () => setExpanded(new Set());

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
        <>
          <div className="grouptools">
            <button className="mo-btn secondary" onClick={expandAll}>
              Expand all
            </button>
            <button className="mo-btn secondary" onClick={collapseAll}>
              Collapse all
            </button>
            <span className="note" style={{ border: 'none', padding: 0, margin: 0 }}>
              {data.exceptions.length} exception{data.exceptions.length === 1 ? '' : 's'} ·{' '}
              {groups.length} rule{groups.length === 1 ? '' : 's'} tripped
            </span>
          </div>

          {groups.map((g) => {
            const open = expanded.has(g.tripwire);
            const owners = new Set(g.items.map((ex) => ex.owner));
            return (
              <div className="propgrp" key={g.tripwire}>
                <button
                  className="propgrp-head"
                  aria-expanded={open}
                  onClick={() => toggle(g.tripwire)}
                >
                  <span className="chev">{open ? '▾' : '▸'}</span>
                  <span className="pname flag">{g.label}</span>
                  <span className="pmeta">
                    {g.items.length} item{g.items.length === 1 ? '' : 's'}
                    {owners.size === 1 && <> · owner {[...owners][0]}</>}
                  </span>
                </button>

                {open && (
                  <div className="propgrp-body">
                    <table className="mo-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Fix required today</th>
                          <th>HDPM Owner</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((ex, i) => (
                          <tr key={ex.workOrderId ?? i}>
                            <td>
                              {ex.workOrderId ? (
                                <Link href={`/maintenance/board/wo/${ex.workOrderId}`}>
                                  {ex.item}
                                </Link>
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
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {data.ruleErrors.length > 0 && (
        <p className="note flag">
          Rule errors: {data.ruleErrors.map((e) => `#${e.tripwire}: ${e.error}`).join(' · ')}
        </p>
      )}

      <p className="note">
        The daily sweep ends when this view reads ZERO — every exception gets an HDPM owner and a date,
        or gets escalated. Expand a rule to work its items. Tripwires #1 and #9 await the Haven.AI
        integration.
      </p>
    </section>
  );
}
