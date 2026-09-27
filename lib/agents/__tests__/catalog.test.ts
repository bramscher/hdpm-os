import { describe, it, expect } from 'vitest';
import { ACTION_LABELS, AGENT_CATALOG, PLANNED_KEYS, actionLabel, agentName, liveStatus } from '../catalog';

const A = (id: string) => AGENT_CATALOG.find((a) => a.id === id)!;
const row = (agent: string, action_type: string, enabled: boolean) => ({ agent, action_type, enabled });
const env = (on: string[]) => (n: string) => on.includes(n);

describe('agent catalog', () => {
  it('names every seeded agent key and action (no raw keys on the page)', () => {
    const seeded = [
      'dez:form_flag', 'ops_brief:send_brief', 'estimate_chaser:vendor_chase', 'estimate_chaser:vendor_chase_sms',
      'estimate_chaser:owner_approval', 'estimate_chaser:escalate', 'estimate_chaser:team_review',
      'estimate_drafter:draft_estimate', 'dez_operator:form_merge', 'inspections:tenant_notice', 'morning_card:daily_card',
      'intake_triage:triage_wo', 'vendor_chaser:vendor_chase', 'invoice_recon:propose_match', 'day_close:sms_day_close',
      'email_triage:route_email', 'intake_haven:emergency_page',
    ];
    for (const k of seeded) expect(ACTION_LABELS[k], k).toBeTruthy();
    for (const k of seeded.map((s) => s.split(':')[0])) expect(agentName(k), k).not.toBe(k);
    expect(actionLabel('x', 'unknown_action')).toBe('unknown_action');
  });

  it('keeps planned agents out of the live catalog', () => {
    for (const a of AGENT_CATALOG) expect(PLANNED_KEYS.has(a.config?.agent ?? a.id), a.id).toBe(false);
  });

  it('derives running/off from config rows, env gates and the kill switch', () => {
    const rows = [
      row('estimate_chaser', 'vendor_chase', true),
      row('estimate_chaser', 'team_review', false),
      row('morning_card', 'daily_card', false),
      row('inspections', 'tenant_notice', true),
      row('dez_operator', 'form_merge', true),
    ];
    expect(liveStatus(A('estimate_chaser'), rows, false, env([])).state).toBe('on');
    expect(liveStatus(A('team_review'), rows, false, env([])).state).toBe('off');
    expect(liveStatus(A('morning_card'), rows, false, env([])).state).toBe('off');
    expect(liveStatus(A('inspection_notice'), rows, false, env([])).state).toBe('off'); // env gate
    expect(liveStatus(A('inspection_notice'), rows, false, env(['DEZ_INSPECTION_NOTICES'])).state).toBe('on');
    expect(liveStatus(A('dez_operator'), rows, false, env(['DEZ_OPERATOR_URL'])).state).toBe('on');
    expect(liveStatus(A('estimate_chaser'), rows, true, env([])).state).toBe('halted');
    expect(liveStatus(A('activities'), rows, false, env([])).state).toBe('on'); // no config row → runs
  });
});
