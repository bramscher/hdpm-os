/**
 * Agent catalog — the plain-English name, purpose and schedule for every
 * agent and scheduled report, shown on /agents. The code keys (agent_config
 * `agent` / `action_type`) stay as they are; this is the display layer.
 *
 * Adding an agent: add an entry here (and its actions to ACTION_LABELS) so it
 * never shows up on the page as a raw key. Times are Pacific; crons run on UTC
 * so they drift an hour in winter.
 */

export type CatalogStatus = 'live' | 'trial' | 'off' | 'planned';

export interface CatalogAgent {
  /** Stable id for the card. */
  id: string;
  name: string;
  what: string;
  why: string;
  helps: string;
  when: string;
  output: string;
  /** Static status; for agents with config rows the page refines it with live settings. */
  status: CatalogStatus;
  /** agent_config rows that decide on/off (agent, and optionally just some actions). */
  config?: { agent: string; actions?: string[] };
  /** Server env switch that must be "1"/set for the agent to run at all. */
  gateEnv?: string;
  note?: string;
}

export const AGENT_CATALOG: CatalogAgent[] = [
  {
    id: 'dez',
    name: 'Dez: Ask HDPM',
    what: 'Answers staff questions in Slack from our SOPs, forms, Oregon landlord-tenant law and live KPIs, with sources.',
    why: 'Saves digging through folders and asking around. One consistent answer for everyone.',
    helps: 'All staff',
    when: 'Whenever you DM Dez or @mention it in a channel',
    output: 'Slack replies; every answer is logged to #dez-activity',
    status: 'live',
    config: { agent: 'dez' },
  },
  {
    id: 'ops_brief',
    name: 'Daily Ops Brief',
    what: 'Sums up what moved today, what is stuck, and what needs a decision. Monday edition goes deeper (vendors, unbilled work, baseline).',
    why: 'Leadership sees the state of operations without opening five screens. It never shows dollar amounts.',
    helps: 'Brody (with Acknowledge buttons), Matt and Craig (copies); editable in Controls',
    when: 'Weekdays ~5 PM; Mondays ~8 AM deep brief',
    output: 'Slack DM',
    status: 'live',
    config: { agent: 'ops_brief' },
  },
  {
    id: 'activities',
    name: 'Activity Reminders',
    what: 'DMs each person their open AppFolio activities, pings when new ones are assigned, and nudges on what’s still open.',
    why: 'Activities in AppFolio are easy to miss. This puts them where people already look.',
    helps: 'Every staff member with a Slack account',
    when: 'Weekdays ~7 AM summary, new ones hourly 8:30 AM–4:30 PM, ~1 PM nudge',
    output: 'Slack DM',
    status: 'live',
  },
  {
    id: 'estimate_chaser',
    name: 'Stuck Estimate Chaser',
    what: 'Finds estimates stuck waiting on a vendor bid or owner approval, and drafts the follow-up email so a person only has to review and send. Can also propose a text to the vendor.',
    why: 'Estimates stall for weeks when nobody chases them. This is “Loop 1” of the agent plan: the one being proven before anything else is built.',
    helps: 'The chase owner (Craig since Sep 15); escalations to Craig',
    when: 'Weekdays ~6:45 AM',
    output: 'Outlook drafts + Slack cards; escalates after 3 chases or 45 days',
    status: 'live',
    config: { agent: 'estimate_chaser', actions: ['vendor_chase', 'vendor_chase_sms', 'owner_approval', 'escalate'] },
    note: 'Pauses automatically when the Maintenance Follow-up Queue is switched on.',
  },
  {
    id: 'team_review',
    name: 'Maintenance Follow-up Queue',
    what: 'Each morning, lists up to 7 of the most overdue estimates, owner approvals and unscheduled work orders for Brody and Craig to review. Nothing is sent until one of them approves it.',
    why: 'One shared, reviewed queue instead of one person chasing everything alone.',
    helps: 'Brody and Craig',
    when: 'Weekdays 8 AM',
    output: 'Slack cards + the Company → Issues page',
    status: 'trial',
    config: { agent: 'estimate_chaser', actions: ['team_review'] },
    note: 'Replaces the Stuck Estimate Chaser while it is on.',
  },
  {
    id: 'estimate_drafter',
    name: 'Estimate Drafter',
    what: 'Picks likely line items from the Price Book for a job; the pricing engine (not AI) computes every amount.',
    why: 'Estimates start from a sensible draft instead of a blank page.',
    helps: 'Whoever builds estimates',
    when: 'When you click “Draft estimate” in the estimate builder',
    output: 'A pre-filled estimate to review and edit',
    status: 'live',
    config: { agent: 'estimate_drafter' },
  },
  {
    id: 'dez_open_estimates',
    name: 'Open Estimates Card',
    what: 'Ask Dez for the open estimates and get one grouped list: escalated, bid in hand, waiting, cooling off.',
    why: 'A quick status check without opening the board. It only reads; it never chases anyone.',
    helps: 'Anyone who asks Dez',
    when: 'On request (“show me the open estimates”)',
    output: 'Slack card',
    status: 'live',
  },
  {
    id: 'dez_operator',
    name: 'AppFolio Form Filler',
    what: 'Fills the deposit-to-hold form in AppFolio for you. It only sends after a person taps Approve & Send.',
    why: 'Removes retyping the same details into AppFolio.',
    helps: 'Leasing',
    when: 'On request through Dez; health check Mondays ~9 AM (DMs Craig if it breaks)',
    output: 'A filled AppFolio form awaiting approval',
    status: 'live',
    config: { agent: 'dez_operator' },
    gateEnv: 'DEZ_OPERATOR_URL',
  },
  {
    id: 'inspection_notice',
    name: 'Inspection Notice Card',
    what: 'When inspections are scheduled, DMs Brody the list of tenant notices to send. He sends them himself.',
    why: 'Tenants get proper notice before an inspection, without building the list by hand.',
    helps: 'Brody',
    when: 'When an inspection schedule is created',
    output: 'Slack DM',
    status: 'off',
    config: { agent: 'inspections' },
    gateEnv: 'DEZ_INSPECTION_NOTICES',
  },
  {
    id: 'morning_card',
    name: 'Cheryl’s Morning Seven',
    what: 'A morning card with the seven most important maintenance items for the day.',
    why: 'Was the second loop in the plan. Deliberately switched off until the estimate chase proves itself.',
    helps: 'Cheryl (copies to Brody and Matt)',
    when: 'Not scheduled',
    output: 'Slack DM',
    status: 'off',
    config: { agent: 'morning_card' },
  },
];

export interface ScheduledReport {
  name: string;
  what: string;
  helps: string;
  when: string;
  output: string;
}

/** Scheduled jobs that message people but aren't agent_config agents. */
export const SCHEDULED_REPORTS: ScheduledReport[] = [
  {
    name: 'Haven Daily Digest',
    what: 'New Haven escalations, hot leads going cold, and pending follow-ups. Sends nothing on a quiet day.',
    helps: 'Brody and Matt',
    when: 'Weekdays ~7:15 AM',
    output: 'Slack DM',
  },
  {
    name: 'Maintenance Tripwire Digest',
    what: 'Runs the 12 maintenance tripwires (stuck, late or unassigned work) and emails each owner their exceptions.',
    helps: 'Whoever owns the flagged work',
    when: 'Weekdays ~6 AM',
    output: 'Email',
  },
  {
    name: 'Unbilled Work Report',
    what: 'Work that was verified complete but never billed.',
    helps: 'Penny',
    when: 'Mondays ~7 AM',
    output: 'Email',
  },
  {
    name: 'Escalation Ladder',
    what: 'Turns aged tripwires, stuck estimate chases and twice-missed to-dos into Company issues.',
    helps: 'Leadership (Company → Issues)',
    when: 'Weekdays ~7:15 AM',
    output: 'Company issues + one Slack nudge',
  },
  {
    name: 'Scorecard Update',
    what: 'Fills the company scorecard from the day’s metrics; on Fridays also nudges metric owners and sends Rock check-ins.',
    helps: 'Scorecard and Rock owners',
    when: 'Weekdays ~7 AM; Fridays ~3 PM',
    output: 'Scorecard + Slack cards',
  },
  {
    name: 'L10 Meeting Prep',
    what: 'Builds the weekly meeting packet: scorecard changes, aged issues, to-do completion.',
    helps: 'The meeting facilitator',
    when: 'Mondays ~7:30 AM',
    output: 'Slack DM with the packet link',
  },
  {
    name: 'Knowledge Nightly Review',
    what: 'Tidies what the knowledge base has learned: removes duplicates, flags contradictions, and asks questions when unsure.',
    helps: 'Everyone who asks Dez (better answers)',
    when: 'Nightly ~3 AM',
    output: 'Questions appear in the Knowledge questions list on this page',
  },
  {
    name: 'Oregon Law Watch',
    what: 'Checks for new ORS 90 sections the knowledge base doesn’t know about yet; reminds after each legislative session.',
    helps: 'Craig',
    when: 'Monthly on the 1st; April and August session reviews',
    output: 'Slack DM when something new appears',
  },
];

/** Built in the seed config but never implemented — listed so nobody thinks they're running. */
export const PLANNED_AGENTS: { key: string; name: string; what: string }[] = [
  { key: 'intake_triage', name: 'Work Order Triage', what: 'Sort and route incoming work orders.' },
  { key: 'vendor_chaser', name: 'Vendor Schedule Chaser', what: 'Chase vendors who miss a scheduled date.' },
  { key: 'invoice_recon', name: 'Invoice Reconciliation', what: 'Suggest invoice-to-bill matches for accounting.' },
  { key: 'day_close', name: 'End-of-Day Check', what: 'End-of-day text check-in with the field team.' },
  { key: 'email_triage', name: 'Front Desk Email Triage', what: 'Route incoming office email to the right person.' },
  { key: 'intake_haven', name: 'After-hours Emergency Pager', what: 'Page the on-call person for Haven emergencies.' },
];
export const PLANNED_KEYS = new Set(PLANNED_AGENTS.map((p) => p.key));

/** Plain names for agent_config agent keys (controls, proposals). */
export const AGENT_NAMES: Record<string, string> = {
  dez: 'Dez: Ask HDPM',
  ops_brief: 'Daily Ops Brief',
  activities: 'Activity Reminders',
  estimate_chaser: 'Stuck Estimate Chaser',
  estimate_drafter: 'Estimate Drafter',
  dez_open_estimates: 'Open Estimates Card',
  dez_operator: 'AppFolio Form Filler',
  inspections: 'Inspection Notice Card',
  morning_card: 'Cheryl’s Morning Seven',
  meeting_prep: 'L10 Meeting Prep',
  ...Object.fromEntries(PLANNED_AGENTS.map((p) => [p.key, p.name])),
};

/** Plain names for agent actions, keyed "agent:action". */
export const ACTION_LABELS: Record<string, string> = {
  'dez:form_flag': 'Flag a possibly out-of-date form to Craig',
  'ops_brief:send_brief': 'Send the brief',
  'estimate_chaser:vendor_chase': 'Email the vendor for a bid or status',
  'estimate_chaser:vendor_chase_sms': 'Text the vendor (Zoom SMS)',
  'estimate_chaser:owner_approval': 'Ask the owner to approve the estimate',
  'estimate_chaser:escalate': 'Escalate a stuck estimate',
  'estimate_chaser:team_review': 'Maintenance Follow-up Queue (Penny & Craig review)',
  'estimate_drafter:draft_estimate': 'Draft estimate line items',
  'dez_operator:form_merge': 'Fill the deposit-to-hold form in AppFolio',
  'inspections:tenant_notice': 'List tenant notices to send',
  'morning_card:daily_card': 'Send the morning priority card',
  'intake_triage:triage_wo': 'Sort incoming work orders',
  'vendor_chaser:vendor_chase': 'Chase a vendor on a missed date',
  'invoice_recon:propose_match': 'Suggest invoice-to-bill matches',
  'day_close:sms_day_close': 'End-of-day text check-in',
  'email_triage:route_email': 'Route incoming email',
  'intake_haven:emergency_page': 'Page on-call for an emergency',
};

export const agentName = (key: string) => AGENT_NAMES[key] ?? key;
export const actionLabel = (agent: string, action: string) => ACTION_LABELS[`${agent}:${action}`] ?? action;

export type LiveState = 'on' | 'off' | 'halted' | 'planned';

/**
 * Whether a catalog agent is actually running: planned agents never are; a
 * required server switch that's unset keeps it off; the kill switch halts
 * everything with config; otherwise its agent_config rows decide (all
 * disabled → off). Agents without config follow their static status.
 */
export function liveStatus(
  a: CatalogAgent,
  rows: { agent: string; action_type: string; enabled: boolean }[],
  killed: boolean,
  envOn: (name: string) => boolean
): { state: LiveState; reason?: string } {
  if (a.status === 'planned') return { state: 'planned' };
  if (a.gateEnv && !envOn(a.gateEnv)) return { state: 'off', reason: `Needs the ${a.gateEnv} server setting (currently off)` };
  if (a.config) {
    if (killed) return { state: 'halted', reason: 'Kill switch is on' };
    const governing = rows.filter((r) => r.agent === a.config!.agent && (!a.config!.actions || a.config!.actions.includes(r.action_type)));
    if (governing.length === 0) return { state: a.status === 'off' ? 'off' : 'on' };
    return governing.some((r) => r.enabled) ? { state: 'on' } : { state: 'off', reason: 'Switched off in Controls' };
  }
  return { state: a.status === 'off' ? 'off' : 'on' };
}
