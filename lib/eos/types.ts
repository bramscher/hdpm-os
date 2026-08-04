/** EOS operating-layer row types (Phase 2, Brief 2A — docs/hdpm-os/06 §2). */

export interface Seat {
  id: string;
  org_id: string;
  name: string;
  roles: string[];
  reports_to_seat_id: string | null;
  person: string | null; // staff.person; null = open seat
  gwc_notes: string | null;
  active: boolean;
  sort: number;
}

export type GoalOp = 'gte' | 'lte';
export type MetricSource = 'metrics_snapshot' | 'kpi_snapshot' | 'sql' | 'manual';

export interface ScorecardMetric {
  id: string;
  org_id: string;
  name: string;
  owner_person: string | null;
  cadence: 'weekly' | 'monthly';
  unit: string | null;
  goal_op: GoalOp;
  goal_value: number | null;
  source: MetricSource;
  source_ref: string | null; // '<metric>.<field>' for snapshot sources
  active: boolean;
  sort: number;
}

export interface ScorecardEntry {
  id: string;
  metric_id: string;
  week_start: string; // Monday, YYYY-MM-DD
  value: number | null;
  on_track: boolean | null;
  source: 'auto' | 'manual';
  entered_by: string | null;
}

export type IssueStatus = 'open' | 'discussed' | 'solved' | 'parked';

export interface Issue {
  id: string;
  org_id: string;
  title: string;
  detail: string | null;
  raised_by: string;
  source_ref: string | null;
  priority: number;
  status: IssueStatus;
  solved_decision_id: string | null;
  created_at: string;
  updated_at: string;
}

export type TodoStatus = 'open' | 'done' | 'missed' | 'rolled';

export interface Todo {
  id: string;
  org_id: string;
  title: string;
  owner_person: string | null;
  due_on: string;
  source: 'meeting' | 'issue' | 'decision' | 'agent' | 'manual';
  source_id: string | null;
  status: TodoStatus;
  done_at: string | null;
  created_at: string;
}

export interface Meeting {
  id: string;
  org_id: string;
  kind: 'L10' | 'huddle' | 'quarterly' | 'annual' | 'same_page';
  starts_at: string;
  seat_scope: string | null;
  agenda: unknown[];
  minutes_md: string | null;
  rating: number | null;
  facilitator_person: string | null;
  prep_packet_md: string | null;
  created_at: string;
}

export interface Decision {
  id: string;
  org_id: string;
  title: string;
  statement_md: string;
  context_md: string | null;
  decided_by: string;
  decided_in_meeting_id: string | null;
  issue_id: string | null;
  effective_on: string;
  supersedes_decision_id: string | null;
  status: 'active' | 'superseded';
  created_at: string;
}

export interface Rock {
  id: string;
  org_id: string;
  title: string;
  owner_person: string | null;
  quarter: string; // '2026-Q3'
  due_on: string | null;
  status: 'on' | 'off' | 'done' | 'dropped';
  milestones: unknown[];
  created_from_issue_id: string | null;
  notes: string | null;
}
