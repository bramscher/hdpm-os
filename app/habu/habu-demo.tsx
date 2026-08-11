'use client';

import { useMemo, useState } from 'react';
import {
  instantiateSteps,
  applyJacketAction,
  buildCardModel,
  leadStep,
  type Jacket,
  type JacketStep,
  type JacketTemplate,
} from '@habu/core/jacket';
import { agentActorFor, signature, type AgentIdentity } from '@habu/core/agent';

// A named agent that HOLDS a seat (§3): a face, a voice, declared expertise.
// NB: a NEW HABU agent (purpose-built for running jackets), not one of HDPM's
// existing ops agents — the core is agent-agnostic, this is just an `agent` row.
const MOVE_OUT_AGENT: AgentIdentity = {
  id: 'move_out',
  org_id: 'hdpm',
  display_name: 'Move-Out Agent', // process name for now; the team personalizes it later
  title: 'Turnover Coordinator',
  avatar: '🧰',
  persona: 'friendly, terse, a little dogged',
  expertise: ['turnover scheduling', 'key tracking', 'deadline watching'],
  model: 'claude-sonnet-5',
  active: true,
};

// Which demo steps are held by an agent seat (rest are human seats).
const AGENT_STEPS: Record<string, AgentIdentity> = { 'step-1': MOVE_OUT_AGENT };

// A move-out jacket template (Appendix A.1, trimmed for the demo). Step 3 closes
// ITSELF when AppFolio reports the clean is scheduled — no human comes back.
const TEMPLATE: JacketTemplate = {
  id: 'demo-move-out',
  org_id: 'demo',
  key: 'move-out',
  title: 'Move-out',
  color: 'yellow',
  active: true,
  steps: [
    { label: 'Save move-out date in AppFolio', seat_role: 'Coordinator', requires: 'tap' },
    { label: 'Schedule turnover clean', seat_role: 'Coordinator', requires: 'tap' },
    {
      label: 'Confirm clean scheduled',
      seat_role: 'Coordinator',
      requires: 'external_event',
      external_match: { source: 'appfolio', event_type: 'wo_scheduled', subject_key: 'wo-123' },
    },
    { label: 'Final accounting & close out', seat_role: 'Finance', requires: 'tap' },
  ],
};

const CREATED = new Date('2026-08-11T00:00:00Z');
const TODAY = '2026-08-11';

function freshJacket(): Jacket {
  return {
    id: 'demo-jacket',
    org_id: 'demo',
    template_id: TEMPLATE.id,
    title: '8/14 · 123 Elm St #4',
    color: 'yellow',
    attention: 'now',
    current_seat_id: 'Coordinator',
    subject_type: 'work_order',
    subject_id: 'wo-123',
    status: 'open',
    created_at: CREATED.toISOString(),
    closed_at: null,
  };
}

function freshSteps(): JacketStep[] {
  return instantiateSteps(TEMPLATE, {
    jacketId: 'demo-jacket',
    anchors: { created: CREATED },
    resolveSeat: (role) => role ?? null,
    newId: (o) => `step-${o}`,
  });
}

type LogEntry = { text: string; kind: 'human' | 'system' | 'agent' };

export default function HabuDemo() {
  const [jacket, setJacket] = useState<Jacket>(freshJacket);
  const [steps, setSteps] = useState<JacketStep[]>(freshSteps);
  const [log, setLog] = useState<LogEntry[]>([]);

  const card = useMemo(
    () => buildCardModel(jacket, steps, { today: TODAY }),
    [jacket, steps]
  );
  const active = useMemo(() => leadStep(steps), [steps]);
  const waitingExternal = active?.requires === 'external_event';
  const activeAgent = active ? AGENT_STEPS[active.id] : undefined;

  function tap() {
    if (!active) return;
    const r = applyJacketAction(jacket, steps, { kind: 'tap', step_id: active.id, actor: 'you' }, {
      at: new Date().toISOString(),
      today: TODAY,
    });
    setJacket(r.jacket);
    setSteps(r.steps);
    setLog((l) => [
      { text: `You tapped “${active.label}” → ${r.transition.type === 'completed' ? 'jacket done' : 'routed on'}`, kind: 'human' },
      ...l,
    ]);
  }

  function agentAct() {
    if (!active || !activeAgent) return;
    const r = applyJacketAction(
      jacket,
      steps,
      { kind: 'tap', step_id: active.id, actor: agentActorFor(activeAgent) },
      { at: new Date().toISOString(), today: TODAY }
    );
    setJacket(r.jacket);
    setSteps(r.steps);
    setLog((l) => [
      { text: `${activeAgent.display_name} handled “${active.label}” and moved it on. ${signature(activeAgent)}`, kind: 'agent' },
      ...l,
    ]);
  }

  function fireExternal() {
    const r = applyJacketAction(
      jacket,
      steps,
      { kind: 'external', event: { source: 'appfolio', event_type: 'wo_scheduled', subject_key: 'wo-123' } },
      { at: new Date().toISOString(), today: TODAY }
    );
    setJacket(r.jacket);
    setSteps(r.steps);
    setLog((l) => [
      { text: 'AppFolio reported wo_scheduled → step closed itself, no human ack', kind: 'system' },
      ...l,
    ]);
  }

  function reset() {
    setJacket(freshJacket());
    setSteps(freshSteps());
    setLog([]);
  }

  const doneCount = steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <header style={{ marginBottom: 28 }}>
          <div style={S.kicker}>HABU · @habu/core</div>
          <h1 style={S.h1}>The jacket that closes itself</h1>
          <p style={S.sub}>
            One line, one color, one button (§7). Tap to advance; when work lands
            elsewhere, the external event closes the step — the human never comes
            back to report. This card is driven by the real core engine in your
            browser, no backend.
          </p>
        </header>

        {/* The card */}
        <div style={{ ...S.card, opacity: card.collapsed ? 0.75 : 1 }}>
          <div style={S.cardRow}>
            <span style={{ fontSize: 22 }}>{card.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={S.cardTitle}>{card.title}</div>
              <div style={S.cardSub}>
                {card.subtitle}
                {card.overdue && <span style={S.overdue}> · overdue</span>}
              </div>
            </div>
            {!card.collapsed && (
              <span style={S.stepBadge}>
                step {doneCount + 1}/{steps.length}
              </span>
            )}
          </div>

          {!card.collapsed && card.action && (
            <div style={{ marginTop: 14 }}>
              {waitingExternal ? (
                <div style={S.waitingNote}>
                  ⏳ Waiting on AppFolio to confirm the clean is scheduled. This step
                  closes itself — see the panel below.
                </div>
              ) : activeAgent ? (
                <div style={S.agentBox}>
                  <div style={S.agentRow}>
                    <span style={{ fontSize: 20 }}>{activeAgent.avatar}</span>
                    <div style={{ flex: 1 }}>
                      <div style={S.agentName}>
                        {activeAgent.display_name} <span style={S.agentTitle}>· {activeAgent.title}</span>
                      </div>
                      <div style={S.agentExp}>holds this seat · {activeAgent.expertise.join(' · ')}</div>
                    </div>
                    <span style={S.agentTag}>agent seat</span>
                  </div>
                  <button style={{ ...S.primaryBtn, marginTop: 12 }} onClick={agentAct}>
                    ▶ Let {activeAgent.display_name} handle it
                  </button>
                  <div style={S.agentEscalate}>
                    ↑ escalates to <b>you</b> (Coordinator) if it stalls or hits its ceiling
                  </div>
                </div>
              ) : (
                <button style={S.primaryBtn} onClick={tap}>
                  {card.action.label}
                </button>
              )}
            </div>
          )}

          {card.collapsed && (
            <div style={{ ...S.waitingNote, marginTop: 12, color: '#15803d' }}>
              ✅ Clean board — the jacket ran end to end. 0 needs you 🎉
            </div>
          )}
        </div>

        {/* "Elsewhere" — the external world */}
        <div style={S.elsewhere}>
          <div style={S.elsewhereHdr}>Meanwhile, in AppFolio…</div>
          <p style={S.elsewhereBody}>
            The “Confirm clean scheduled” step matches an external event. When
            AppFolio fires <code>wo_scheduled</code> for <code>wo-123</code>, the
            step auto-completes.
          </p>
          <button
            style={{ ...S.ghostBtn, opacity: waitingExternal ? 1 : 0.4, cursor: waitingExternal ? 'pointer' : 'not-allowed' }}
            onClick={waitingExternal ? fireExternal : undefined}
            disabled={!waitingExternal}
          >
            ⚡ Simulate AppFolio “wo_scheduled”
          </button>
        </div>

        {/* Step timeline */}
        <div style={S.timeline}>
          {steps.map((s) => (
            <div key={s.id} style={S.stepLine}>
              <span style={{ ...S.dot, background: dotColor(s.state) }} />
              <span style={{ flex: 1, color: s.state === 'active' ? '#111' : '#666', fontWeight: s.state === 'active' ? 600 : 400 }}>
                {s.label}
              </span>
              <span style={S.stepMeta}>
                {s.state}
                {s.done_by ? ` · ${s.done_by}` : ''}
              </span>
            </div>
          ))}
        </div>

        {/* Log */}
        {log.length > 0 && (
          <div style={S.logBox}>
            {log.map((e, i) => (
              <div
                key={i}
                style={{ color: e.kind === 'system' ? '#2563eb' : e.kind === 'agent' ? '#7c3aed' : '#111', fontSize: 13, padding: '2px 0' }}
              >
                {e.kind === 'system' ? '↩︎ ' : e.kind === 'agent' ? '🤖 ' : '→ '}
                {e.text}
              </div>
            ))}
          </div>
        )}

        <button style={S.reset} onClick={reset}>
          ↺ Reset
        </button>
      </div>
    </div>
  );
}

function dotColor(state: JacketStep['state']): string {
  if (state === 'done') return '#22c55e';
  if (state === 'skipped') return '#9ca3af';
  if (state === 'active') return '#f59e0b';
  if (state === 'blocked') return '#ef4444';
  return '#d1d5db';
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f6f6f7', padding: '48px 20px', fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif', color: '#111' },
  wrap: { maxWidth: 560, margin: '0 auto' },
  kicker: { fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: '#8b8b8f', fontWeight: 600 },
  h1: { fontSize: 30, fontWeight: 700, margin: '6px 0 10px', letterSpacing: -0.5 },
  sub: { fontSize: 15, lineHeight: 1.55, color: '#555' },
  card: { background: '#fff', borderRadius: 16, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.04)', transition: 'opacity .2s' },
  cardRow: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  cardTitle: { fontSize: 16, fontWeight: 600 },
  cardSub: { fontSize: 14, color: '#666', marginTop: 2 },
  overdue: { color: '#dc2626', fontWeight: 600 },
  stepBadge: { fontSize: 12, color: '#8b8b8f', whiteSpace: 'nowrap' },
  primaryBtn: { background: '#111', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  waitingNote: { fontSize: 13, color: '#92700a', background: '#fef9ec', borderRadius: 10, padding: '10px 12px', lineHeight: 1.45 },
  elsewhere: { marginTop: 16, background: '#fff', border: '1px dashed #d4d4d8', borderRadius: 14, padding: 16 },
  elsewhereHdr: { fontSize: 13, fontWeight: 600, color: '#3f3f46' },
  elsewhereBody: { fontSize: 13, color: '#666', lineHeight: 1.5, margin: '6px 0 12px' },
  ghostBtn: { background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600 },
  timeline: { marginTop: 20, background: '#fff', borderRadius: 14, padding: '8px 16px' },
  stepLine: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #f1f1f2', fontSize: 14 },
  dot: { width: 9, height: 9, borderRadius: 999, flexShrink: 0 },
  stepMeta: { fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' },
  agentBox: { background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 12, padding: 14 },
  agentRow: { display: 'flex', gap: 10, alignItems: 'center' },
  agentName: { fontSize: 14, fontWeight: 600, color: '#3b0764' },
  agentTitle: { fontWeight: 400, color: '#7c3aed' },
  agentExp: { fontSize: 12, color: '#8b5cf6', marginTop: 1 },
  agentTag: { fontSize: 11, color: '#7c3aed', background: '#f3e8ff', borderRadius: 999, padding: '3px 8px', whiteSpace: 'nowrap' },
  agentEscalate: { fontSize: 12, color: '#6b7280', marginTop: 10 },
  logBox: { marginTop: 16, background: '#fafafa', border: '1px solid #eee', borderRadius: 12, padding: 12 },
  reset: { marginTop: 20, background: 'transparent', border: 'none', color: '#8b8b8f', fontSize: 13, cursor: 'pointer' },
};
