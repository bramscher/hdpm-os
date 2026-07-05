/**
 * In-context help for the Maintenance OS — one short guide per view,
 * shown behind the ⓘ button. Keep entries to 4–7 plain-language bullets;
 * the full reference lives in README.md → "Maintenance OS (Live Board)".
 */

export interface HelpGuide {
  title: string;
  intro?: string;
  bullets: React.ReactNode[];
}

export const HELP_GUIDES: Record<string, HelpGuide> = {
  open: {
    title: 'Open Board',
    intro: 'Every open work order, one column per stage. AppFolio is the system of record — status, scheduling, and vendors are edited there; this board follows within 15 minutes.',
    bullets: [
      <>Card = what/where · <b>HDPM owner</b> · next-action date. A <span className="flag">red date</span> is past due and automatically becomes an Exception.</>,
      <>Left-edge color = priority: <span className="flag">red P1</span> (emergency), <span className="warn">amber P2</span> (urgent), <span className="ok">green P3</span> (routine), gray P4 (planned).</>,
      <>Click any card to open its detail page (stage changes, AI Next Action, closure gate).</>,
      <>Scroll sideways for more columns. Header tiles show the day&apos;s vital signs.</>,
    ],
  },
  triage: {
    title: '✦ Triage Review',
    intro: 'Clear the backlog by reviewing AI proposals instead of typing. Nothing changes a work order until you act.',
    bullets: [
      <><b>Generate proposals</b> runs the AI across untriaged work orders (~25s / ~4¢ each). Pause anytime — it resumes where it left off.</>,
      <>Each row: AI summary, risk flags, and recommended next step, with proposed <b>priority / date / HDPM owner</b> as editable dropdowns.</>,
      <><b>Apply</b> accepts a row, <b>Skip</b> dismisses it. Change a dropdown first and Apply uses your edit.</>,
      <><b>Apply all untouched</b> bulk-applies — rows you edited are excluded and stay for individual review.</>,
      <>Every apply is logged to the work order&apos;s timeline under your name, exactly like manual triage.</>,
    ],
  },
  wait: {
    title: 'Waiting-On',
    intro: 'One table for everything blocked. Nothing waits silently — every row has a next action, a date, and one HDPM owner.',
    bullets: [
      <>Chip filters by wait type: Tenant / Vendor / Parts / Owner / Weather / Internal. Badge colors are the same everywhere in the app.</>,
      <>The days pill is the urgency signal: <span className="ok">green ≤2</span> · <span className="warn">amber 3–5</span> · <span className="flag">red &gt;5</span> — red means chase by phone today.</>,
      <>Heads-up: the purple <b>OWNER</b> badge means the <i>property</i> owner. &quot;HDPM Owner&quot; is the accountable team member.</>,
    ],
  },
  vendor: {
    title: 'Vendor Scoreboard',
    intro: 'Rankings with teeth. Two windows: all-time history (seeded from thousands of closed jobs) and rolling 90 days (builds from live assignments).',
    bullets: [
      <><b>History:</b> jobs closed · median → p90 cycle time · % taking over 30 days. <span className="flag">Red</span> = median past 21 days.</>,
      <><b>Days open (med/avg):</b> how old this vendor&apos;s current open pile is — the &quot;sitting on work&quot; signal.</>,
      <><b>Edit</b> maintains the profile: trades, license/insurance expiry, W-9, rates, preferred/emergency flags.</>,
      <>The <b>demoted</b> switch forces a vendor to the bottom of dispatch ranking — flip it at Monday review, not in the moment.</>,
    ],
  },
  aging: {
    title: 'Aging',
    intro: 'Where old work orders explain themselves. Ages use real AppFolio creation dates.',
    bullets: [
      <>Buckets: 0–7 / 8–14 / 15–30 / <b>30+</b> days. The 30+ bucket is the Monday review&apos;s main course.</>,
      <>Every item over 15 days needs a <b>written reason</b> (&quot;why it&apos;s old&quot;) — set it on the work order&apos;s detail page. Missing reasons flag <span className="flag">red</span>.</>,
      <>Ops target: 30+ bucket under 5 items, each with a reason said aloud on Monday.</>,
    ],
  },
  exceptions: {
    title: 'Exceptions',
    intro: 'The daily sweep. Twelve automated tripwires check every invariant; the day is done when this view reads ZERO.',
    bullets: [
      <>Each row = one broken rule + the <b>fix required today</b> + the HDPM owner obligated to do it. Rows link to the work order.</>,
      <>The same rules email each person their own items at 6 AM on weekdays — one email, only their rows, nothing on a clean day.</>,
      <>Admins: <b>Digest recipients</b> (top panel) controls who gets the email. Enter an address, tick enabled — live the next morning.</>,
      <>Phase-1 definition of done: five consecutive business days at zero.</>,
    ],
  },
  turnover: {
    title: 'Turnover',
    intro: 'Vacant-unit turns — vacancy is rent lost daily, so every turn shows its single current blocker and who owns it.',
    bullets: [
      <>Columns: days vacant · target-ready (<span className="ok">on track</span> / <span className="warn">at risk</span> / <span className="flag">slipping</span>) · current blocker · assignee · budget vs actual.</>,
      <>To add a turn: open the work order&apos;s detail page → tick <b>&quot;This is a turn&quot;</b>, then set vacated date, target, and budget.</>,
      <>Leasing reads target-ready dates from this view — keep them honest.</>,
    ],
  },
  monday: {
    title: 'Monday Review',
    intro: 'The 30-minute ops meeting, generated live. No slides, no prep — walk the table top to bottom.',
    bullets: [
      <><b>0–5</b> P1s last week · <b>5–12</b> the 30+ bucket, blockers aloud · <b>12–18</b> vendor waits &gt;5d (last chance or reassign + demote) · <b>18–23</b> verify + unbilled · <b>23–28</b> turns · <b>28–30</b> one improvement.</>,
      <>Every line links to the work order it came from — click through when the room needs detail.</>,
      <>The &quot;one improvement&quot; slot rotates through the team; no software involved.</>,
    ],
  },
  detail: {
    title: 'Work Order Detail',
    intro: 'The workflow lives on the left; the closure gate on the right. AppFolio-owned fields (status, scheduling, vendor) are edited in AppFolio — use the Open in AppFolio button.',
    bullets: [
      <><b>✦ AI Next Action:</b> one click generates a summary, priority recommendation with escalate-if conditions, a copy-paste draft message, and an AppFolio checklist (~4¢, cached until you regenerate).</>,
      <><b>Workflow:</b> stage dropdown shows only legal moves; set HDPM owner, next-action date, P1–P4, tech, and the &quot;why it&apos;s old&quot; note here.</>,
      <><b>Closure gate:</b> all six checks must pass before Close unlocks — verification, invoice, recommendations resolved, tenant ping, incidents documented, preventive scheduled.</>,
      <><b>Failed access:</b> log what happened + a new date — the WO auto-returns to SCHEDULED.</>,
      <><b>Timeline</b> is append-only: every change, who made it, when — including sync and tripwire activity.</>,
    ],
  },
};
