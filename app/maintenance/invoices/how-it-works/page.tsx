import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowDown, ArrowRight, CalendarDays, ClipboardCheck, Wrench } from 'lucide-react';
import { requireCompanySession } from '@/lib/require-role';
import './guide.css';

export const metadata = { title: 'How Work & Billing works — HDPM OS' };

const paths = {
  orders: '/maintenance/invoices?tab=work-orders',
  estimates: '/maintenance/invoices?tab=estimates',
  schedule: '/maintenance/workspace?view=schedule',
  field: '/maintenance/field',
  review: '/maintenance/daily-billing',
  invoices: '/maintenance/invoices?tab=invoices',
  reconcile: '/maintenance/invoices?tab=reconcile',
  followups: '/maintenance/estimate-followups',
};

function Down() {
  return <div className="wb-guide-arrow" aria-hidden="true"><ArrowDown size={22} /></div>;
}

const lanes = [
  {
    title: 'Technicians', names: 'Alberto, Brody & assigned field staff',
    task: 'Start with the assigned work order and approved scope. Record actual minutes, progress, materials, and what remains after each visit. Flag blocked work early so the next ready job can be scheduled.',
    handoff: 'Submit work for office review. Prepare an invoice draft when assigned and your access allows it; the reviewer checks the charge before issuance.',
    href: paths.field, link: 'Open my day',
  },
  {
    title: 'Scheduling & field coordination', names: 'Brody / designated scheduler',
    task: 'Keep the next ready jobs visible. Confirm authorization, access, parts, technician, and visit length before booking. Compare available capacity with the local schedule and existing appointments.',
    handoff: 'Each booked visit needs a technician and a clear next task. Reassign gaps or blocked visits; keep travel and parts time realistic.',
    href: paths.schedule, link: 'Review availability',
  },
  {
    title: 'Estimate follow-ups', names: 'Penny & Craig / assigned reviewer',
    task: 'Review vendor bids and owner approvals that may need a push. Confirm the current status, recipient, message, and whether contact is appropriate.',
    handoff: 'Approve each email or text before sending. If waiting, record the owner and next review date. Bring scope or authorization questions to Craig.',
    href: paths.followups, link: 'Open follow-up queue',
  },
  {
    title: 'Billing preparation & review', names: 'Cheryl, Penny & authorized office staff',
    task: 'Review submitted work and invoice drafts, including appliances. Verify the property, work order, service date, technician, labor, materials, and approved price. Return specific questions when information is missing.',
    handoff: 'Use the invoice actions your account permits. Check the final PDF, then verify the AppFolio bill and payment separately. Give unresolved items an owner and review date.',
    href: paths.review, link: 'Open daily billing review',
  },
  {
    title: 'Accountability & exceptions', names: 'Craig / admin',
    task: 'Set expectations, resolve approval and pricing questions, assign reviewers, and manage staff access. Compare confirmed timecard hours with recorded work and billing to find unexplained gaps.',
    handoff: 'Resolve the reason for a gap before calling it missed billing. Review repeat blockers and make sure each exception has a next action.',
    href: paths.review, link: 'Review the daily picture',
  },
];

export default async function WorkBillingGuide() {
  const guard = await requireCompanySession();
  if (!guard.ok) redirect('/login');

  return (
    <main className="wb-guide">
      <Link href="/maintenance/invoices" className="wb-guide-back">← Work &amp; Billing</Link>
      <header className="wb-guide-intro">
        <p className="wb-guide-eyebrow">THE STAFF GUIDE</p>
        <h1>How Work &amp; Billing works</h1>
        <p>Keep the schedule full, account for the work, and bill accurately. Every job needs an owner, an approved scope, and a clear next action.</p>
        <nav aria-label="Guide sections" className="wb-guide-jumps">
          <a href="#flow">Follow the flow</a><a href="#lanes">Know your lane</a><a href="#daily">Daily routine</a><a href="#accuracy">Keep it accurate</a>
        </nav>
      </header>

      <section id="flow" aria-labelledby="flow-title" className="wb-guide-section">
        <div className="wb-guide-heading"><span>01</span><div><h2 id="flow-title">Follow the work from request to payment</h2><p>Use the same work order throughout. Choose the path that fits the job.</p></div></div>
        <figure className="wb-guide-flow" aria-labelledby="flow-title">
          <div className="wb-guide-node wb-guide-start"><small>START · OFFICE / COORDINATOR</small><h3>Find the work order</h3><p>Confirm property, unit, request, responsible payer, and who owns the next step.</p><Link href={paths.orders}>Open Work Orders <ArrowRight size={15} aria-hidden="true" /></Link></div>
          <Down />
          <div className="wb-guide-decision">Is the scope and charge already authorized?</div>
          <div className="wb-guide-branches">
            <div className="wb-guide-node"><small>NEEDS SCOPE OR APPROVAL</small><h3>Prepare an estimate</h3><p>Use confirmed prices and a clear scope. Issue for review and record actual authorization before starting chargeable work.</p><p className="wb-guide-note">Waiting on a vendor or owner? Assign a follow-up and review every outgoing message.</p><Link href={paths.estimates}>Open Estimates <ArrowRight size={15} aria-hidden="true" /></Link></div>
            <div className="wb-guide-node"><small>ALREADY AUTHORIZED REPAIR</small><h3>Continue from the work order</h3><p>Confirm the approved work and charge basis. A separate estimate is not needed just to prepare an invoice for authorized work.</p><p className="wb-guide-note">Check for an existing invoice or draft first. If the work is already complete, continue to recording and review. Keep additional scope pending until authorized.</p><Link href={paths.orders}>Find the work order <ArrowRight size={15} aria-hidden="true" /></Link></div>
          </div>
          <Down />
          <div className="wb-guide-node"><small>SCHEDULER → TECHNICIAN</small><h3>Book the next ready visit</h3><p>For approved estimates, choose “Set up job &amp; schedule.” Assign the technician and time; confirm access, parts, travel, and existing appointments. Check future gaps before ending the day.</p><Link href={paths.schedule}>Availability &amp; planned revenue <ArrowRight size={15} aria-hidden="true" /></Link></div>
          <Down />
          <div className="wb-guide-node"><small>TECHNICIAN → OFFICE REVIEWER</small><h3>Do the work and record what happened</h3><p>Log the actual date, minutes, progress, and materials. Use the project task log for scoped tasks; use Daily closeout for other work-order activity, travel, parts runs, or shop time. Record each activity once.</p><Link href={paths.field}>Open Field / My Day <ArrowRight size={15} aria-hidden="true" /></Link></div>
          <Down />
          <div className="wb-guide-node"><small>OFFICE REVIEWER → AUTHORIZED BILLER</small><h3>Review the work and prepare the invoice</h3><p>Accept the work, hold it with a reason, or return a specific question. For priced projects, add eligible reviewed tasks to the rolling draft. For ordinary repairs, use “Create invoice” on the work order and review the draft.</p><p className="wb-guide-note">Only bill completed, authorized scope or an explicitly authorized progress milestone. Check previous invoices so each task or visit is covered once.</p><Link href={paths.review}>Review daily billing <ArrowRight size={15} aria-hidden="true" /></Link></div>
          <Down />
          <div className="wb-guide-node wb-guide-finish"><small>BILLING / OFFICE</small><h3>Finalize, verify posting, and reconcile payment</h3><p>Check dates, quantities, prices, materials, technician attribution, and the final PDF. Verify the bill in AppFolio and match it in Reconcile. Confirm payment from payment evidence.</p><p className="wb-guide-note">A saved draft, a generated PDF, an AppFolio bill, and a paid invoice are separate stages.</p><Link href={paths.reconcile}>Open Reconcile <ArrowRight size={15} aria-hidden="true" /></Link></div>
          <figcaption>If work is blocked or information is missing, keep a named owner, a reason, and a next review date. Return to the relevant step when it is ready.</figcaption>
        </figure>
      </section>

      <section id="lanes" aria-labelledby="lanes-title" className="wb-guide-section">
        <div className="wb-guide-heading"><span>02</span><div><h2 id="lanes-title">Know your lane and your handoff</h2><p>One person may fill more than one lane. Name the reviewer for each job so work never waits on “someone.”</p></div></div>
        <div className="wb-guide-lanes">{lanes.map(lane => <article key={lane.title} className="wb-guide-card"><p className="wb-guide-eyebrow">{lane.names}</p><h3>{lane.title}</h3><p>{lane.task}</p><p><strong>Handoff:</strong> {lane.handoff}</p><Link href={lane.href}>{lane.link} <ArrowRight size={15} aria-hidden="true" /></Link></article>)}</div>
        <p className="wb-guide-callout">These lanes describe responsibilities. Available buttons depend on your account permissions. If a needed action is missing, ask Craig to check your access. Everyone sees their own timecard; Craig’s admin access provides the team comparison.</p>
      </section>

      <section id="daily" aria-labelledby="daily-title" className="wb-guide-section">
        <div className="wb-guide-heading"><span>03</span><div><h2 id="daily-title">Use a simple daily rhythm</h2><p>A full schedule starts with ready work. Accurate billing starts with same-day records.</p></div></div>
        <div className="wb-guide-routine">
          <article className="wb-guide-card"><CalendarDays aria-hidden="true" /><h3>Before the first visit</h3><ul><li>Scheduler checks available capacity, ready jobs, appointments, access, and parts.</li><li>Technician opens My Day and confirms the approved scope and next stop.</li><li>Office assigns an owner to approvals or scheduling decisions holding work up.</li></ul></article>
          <article className="wb-guide-card"><Wrench aria-hidden="true" /><h3>After each visit</h3><ul><li>Record actual minutes, materials, and done / partial / blocked progress.</li><li>Describe remaining work and the next visit needed.</li><li>Flag changes before performing extra chargeable scope. Let the scheduler know when a gap opens.</li></ul></article>
          <article className="wb-guide-card"><ClipboardCheck aria-hidden="true" /><h3>Before leaving for the day</h3><ul><li>Technician submits work and accounts for travel, parts, and other activity; checks their timecard separately.</li><li>Office opens Daily Billing Review, reviews drafts and exceptions, and assigns follow-ups.</li><li>Scheduler confirms tomorrow’s ready work; Craig reviews unexplained time and recurring blockers.</li></ul></article>
        </div>
        <p className="wb-guide-callout">Keep work records in HDPM. An Outlook “Daily billing closeout” reminder can link to <Link href={paths.review}>Daily Billing Review</Link>. A calendar appointment alone does not record work or create an invoice.</p>
      </section>

      <section id="accuracy" aria-labelledby="accuracy-title" className="wb-guide-section">
        <div className="wb-guide-heading"><span>04</span><div><h2 id="accuracy-title">Read the numbers correctly</h2><p>Use these distinctions when checking whether the team is fully booked and fully accounted for.</p></div></div>
        <div className="wb-guide-table-wrap"><table><caption>What each measure tells you</caption><thead><tr><th scope="col">Measure</th><th scope="col">What it means</th><th scope="col">What to check</th></tr></thead><tbody>
          <tr><th scope="row">Planned hours / revenue</th><td>Scheduled capacity and expected service value.</td><td>Confirm appointments and readiness. The HDPM schedule is a local plan.</td></tr>
          <tr><th scope="row">Actual activity</th><td>Submitted work minutes on the date work happened.</td><td>Include non-job activity. An empty log means documentation is missing.</td></tr>
          <tr><th scope="row">Invoice hours / labor value</th><td>Recorded hourly quantities and priced labor, split between drafts and issued invoices.</td><td>Flat-price work can have value without measured invoice hours. Missing quantities stay incomplete.</td></tr>
          <tr><th scope="row">Equivalent hours</th><td>A planning comparison of service value against a benchmark.</td><td>Use actual work logs and timecards for elapsed time.</td></tr>
          <tr><th scope="row">Worked / unexplained time</th><td>Admin-only comparison of confirmed timecard hours with submitted activity.</td><td>Scheduled defaults remain unconfirmed. Investigate gaps; they are not automatically billable.</td></tr>
          <tr><th scope="row">AppFolio posting / payment</th><td>A matched bill and a separate payment check.</td><td>Read the snapshot timestamp. Verify existing direct bills before creating another charge.</td></tr>
        </tbody></table></div>
        <div className="wb-guide-faq">
          <details><summary>The job spans several days. What do I enter?</summary><p>Record each visit on its actual work date and mark partial or blocked work accurately. The office reviews the agreed billing milestone and what earlier invoices cover. Invoice totals may appear on a different day because reports use the invoice’s completed date, with a creation-date fallback.</p></details>
          <details><summary>How do we handle appliance invoices?</summary><p>Cheryl, Penny, or another authorized invoice author prepares the draft from the relevant work order. Include the appliance, approved charge, service date, and supporting cost or receipt details. Check labor, materials, and prior charges, then use the same invoice review and reconciliation steps.</p></details>
          <details><summary>An item looks unbilled. Should I create another invoice?</summary><p>First check existing drafts, issued invoices, and direct AppFolio bills. A missing match can be a linking or sync issue. Record the result and next action in Daily Billing Review; creating a duplicate is not a way to clear an exception.</p></details>
          <details><summary>What if an estimate or review is waiting on someone?</summary><p>Assign the next action to a named person and set a review date. For vendor bids or owner approval, use the follow-up queue and review each proposed email or text. For work or billing questions, hold or return the entry with the specific information needed.</p></details>
        </div>
      </section>
      <footer className="wb-guide-footer"><p>Start with today’s work. Leave every unfinished item with an owner and a next step.</p><Link href="/maintenance/invoices">Back to Work &amp; Billing <ArrowRight size={16} aria-hidden="true" /></Link></footer>
    </main>
  );
}
