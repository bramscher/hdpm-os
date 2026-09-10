export const PEOPLE = {
  alex: { name: 'Alex', role: 'Office' },
  sam: { name: 'Sam', role: 'Property manager' },
  jordan: { name: 'Jordan', role: 'Marketing' },
  morgan: { name: 'Morgan', role: 'Accounting' },
  taylor: { name: 'Taylor', role: 'Maintenance' },
} as const;
export type Person = keyof typeof PEOPLE;
export type FormKind = 'vacancy' | 'setup';
/** Packet inventory from the user's office-wall photographs; proposed stage labels. */
export const PAPERWORK: Record<FormKind, { title: string; stage: string }[]> = {
  vacancy: [
    { title: 'Tenant’s notice to vacate', stage: 'Notice received' },
    { title: 'Confirmation of notice to vacate', stage: 'Acknowledge notice' },
    { title: 'Gold Vacancy Tracking sheet', stage: 'Master sheet throughout the vacancy' },
    { title: 'Inspection notes and turn work orders', stage: 'Inspect and prepare the unit' },
    { title: 'Invoices and final accounting', stage: 'Close out the departing tenant' },
  ],
  setup: [
    { title: 'RentZap application summary', stage: 'Application reviewed' },
    { title: 'New Tenant Set-up Form', stage: 'Master sheet throughout move-in' },
    { title: 'Tenant Information Form', stage: 'Collect household information' },
    { title: 'Deposit to Hold form and introductory letter', stage: 'Prepare for the rental agreement' },
    { title: 'Rental agreement and applicable addenda', stage: 'Prepare and sign' },
    { title: 'Move-in appointment / preparation letter', stage: 'Confirm funds, insurance, utilities and appointment' },
    { title: 'New Tenant’s Checklist', stage: 'Move-in handover' },
    { title: 'Tenant move-in condition / inspection form', stage: 'Record initial condition; separate from a repair request' },
  ],
};
export type Row = { id: string; label: string; type: 'task' | 'text' | 'money' | 'number' | 'date' | 'choice'; assignment?: string; options?: string[]; required?: boolean };
export type Section = { id: string; label: string; column: 'left' | 'right' | 'back'; rows: Row[] };
export type Assignment = { id: string; label: string; section: string; owner: Person; needs: string[] };
export type Template = { title: string; color: string; revision: string; header: Row[]; sections: Section[]; assignments: Assignment[] };
const task = (id: string, label: string, assignment: string): Row => ({ id, label, assignment, type: 'task' });
const field = (id: string, label: string, type: Row['type'] = 'text', assignment?: string, required = false, options?: string[]): Row => ({ id, label, type, assignment, required, options });
const yesNo = (id: string, label: string, assignment: string) => field(id, label, 'choice', assignment, false, ['Yes', 'No']);
export const TEMPLATES: Record<FormKind, Template> = {
  vacancy: {
    title: 'Vacancy Tracking', color: 'gold', revision: 'Original form: 11/2025',
    header: [field('property-code', 'Prop #'), field('notice-date', 'Date of Notice', 'date'), field('projected-moveout', 'Projected 30 Day or Specific M/O Date', 'date'), field('names', 'Name(s)'), field('address', 'Address'), field('city', 'City, State, Zip Code'), field('forwarding', 'Forwarding Address'), field('forwarding-city', 'City, State, Zip Code (Forwarding)'), field('moving-reason', 'Reason For Moving')],
    sections: [
      { id: 'tenant', label: 'TENANT', column: 'left', rows: [
        task('af-moveout', 'AppFolio — M/O Date for Tenants — Save for Later', 'notice'),
        task('confirmation', 'M/O Confirmation to Tenant (Share on Page)', 'notice'),
        field('prorated', 'Prorated Rent', 'money', 'notice'),
        task('inspection-calendar', 'Enter Calendar Appt. Move Out Inspection', 'notice'),
        field('inspection-date', 'Move-Out Inspection Appointment', 'date', 'notice'),
        task('scheduled-inspection', 'Check for Scheduled Property Inspection', 'notice'),
        field('submitted-date', 'Date Submitted to Property Manager', 'date', 'notice'),
      ] },
      { id: 'owner', label: 'OWNER', column: 'left', rows: [
        yesNo('landscape-contract', 'Landscape Contract', 'owner'),
        task('landscaper-email', 'Email to Landscaper (if applicable)', 'owner'),
        field('owner-name', 'Owner Name', 'text', 'owner', true),
        field('owner-notified', 'Date Notified', 'date', 'owner', true),
        field('owner-initial', 'Initial', 'text', 'owner'),
        field('owner-fee', 'Owner Termination Fee', 'money', 'owner'),
        field('listing-rent', 'Rent Amount for New Listing', 'money', 'owner', true),
        yesNo('washer-dryer', 'Washer / Dryer', 'owner'),
        field('wd-removal', 'Date W/D Removal Scheduled', 'date', 'owner'),
        yesNo('wsg', 'W/S/G Paid', 'owner'), yesNo('water-sewer', 'Water/Sewer Only Paid', 'owner'),
        yesNo('landscaping-paid', 'Landscaping Paid', 'owner'), yesNo('pets', 'Pets on Approval', 'owner'),
        field('term', 'Lease Term', 'choice', 'owner', true, ['6 Month', '12 Month', 'Month-to-Month']),
        field('availability', 'Availability Date', 'date', 'owner', true),
      ] },
      { id: 'advertising', label: 'ADVERTISING', column: 'left', rows: [
        task('utilities-check', 'Check Utility/Appliances Info', 'advertising'),
        task('af-listing', 'AppFolio / Website Updated', 'advertising'),
        task('craigslist', 'Craigslist Updated', 'advertising'),
        task('posting-copy', 'Attach CL Posting to Prop Page', 'advertising'),
        task('ad-fee', 'Ad Fee Charged', 'advertising'),
      ] },
      { id: 'vacancy', label: 'VACANCY', column: 'right', rows: [
        task('key-reminder', 'Email Key Reminder & Forwarding Address', 'keys'),
        field('keys-returned', 'Date Keys are Returned', 'date', 'keys', true),
        field('key-channel', 'Keys Returned Via', 'choice', 'keys', true, ['HD', 'DB', 'MAIL']),
        field('keys-receiver', 'Rcvd By', 'text', 'keys', true),
        field('key-received-date', 'Date Received in DB / Mail', 'date', 'keys'),
        yesNo('holdover', 'Hold Over Rent Due', 'keys'),
        task('actual-af', 'Enter Actual Move-Out Date in AppFolio', 'keys'),
        field('actual-moveout', 'Actual Move-Out Date', 'date', 'keys', true),
        field('house-keys', '# of House Keys', 'number', 'keys', true), field('mail-keys', '# of Mail Keys', 'number', 'keys'),
        field('garage-issued', '# of Garage Openers Issued', 'number', 'keys'), field('garage-returned', 'Garage Openers Returned', 'number', 'keys'),
        field('pool-issued', '# of Pool Keys Issued', 'number', 'keys'), field('pool-returned', 'Pool Keys Returned', 'number', 'keys'),
        task('keys-email', 'Send Confirming Email (Tenant Pg)', 'keys'), task('keys-receipt', 'Receipt Keys in (AF Prop Pg)', 'keys'),
        task('pm-box', 'Pull All Keys / PM Inspection Box', 'keys'), field('new-movein', 'New Tenant Move-In Date', 'date', 'keys'),
      ] },
      { id: 'closeout', label: 'CLOSE OUT TENANTS', column: 'right', rows: [
        field('early-fee', 'Early Termination Fee', 'money', 'closeout'), task('penny-charge', 'Email to Penny Charge (if applicable)', 'closeout'),
        field('holdover-amount', 'Hold Over Rent Due', 'money', 'closeout'), field('credits', 'Credits Due to Tenant', 'money', 'closeout'),
        task('af-forwarding', 'AppFolio — Enter Fwd Address', 'closeout'), task('balances', 'Check Outstanding Balances', 'closeout'),
        task('final-accounting', 'Create Final Accounting', 'closeout'), task('transfer', 'Transfer Funds', 'closeout'),
        task('management-fees', 'Post Management Fees', 'closeout'), task('vendor-invoices', 'Enter Vendor Invoices', 'closeout'),
        task('mail-check', 'Mail Check & Information to Tenant', 'closeout'),
      ] },
      { id: 'turn', label: 'BACK — INSPECTION & TURN WORK', column: 'back', rows: [
        task('inspect-unit', 'Move-out inspection completed', 'inspection'), task('turn-verified', 'Verify work orders and unit readiness', 'verify'),
      ] },
    ],
    assignments: [
      { id: 'notice', label: 'Prepare and submit notice', section: 'tenant', owner: 'alex', needs: [] },
      { id: 'owner', label: 'Confirm owner and listing details', section: 'owner', owner: 'sam', needs: ['notice'] },
      { id: 'advertising', label: 'Update advertising', section: 'advertising', owner: 'jordan', needs: ['owner'] },
      { id: 'keys', label: 'Receive and receipt returned keys', section: 'vacancy', owner: 'alex', needs: ['notice'] },
      { id: 'inspection', label: 'Inspect the unit', section: 'turn', owner: 'sam', needs: ['keys'] },
      { id: 'turn-work', label: 'Complete turn work orders', section: 'turn', owner: 'taylor', needs: ['inspection'] },
      { id: 'verify', label: 'Verify unit readiness', section: 'turn', owner: 'sam', needs: ['turn-work'] },
      { id: 'closeout', label: 'Complete tenant accounting', section: 'closeout', owner: 'morgan', needs: ['keys'] },
    ],
  },
  setup: {
    title: 'New Tenant Set-up Form', color: 'green', revision: 'Original form: 8/13/2026',
    header: [field('movein-appointment', 'MOVE-IN APPT', 'date'), field('rentzap-received', 'Received — Rent Zap', 'date'), field('deposit-due', 'Deposit to Hold Due', 'date'), field('hud-inspection', 'HUD Inspect Date', 'date'), field('lease-type', 'LEASE TYPE', 'choice', undefined, false, ['MTM', 'Fixed Term']), field('lease-months', 'Months', 'number'), field('names', 'Name'), field('phone', 'Phone'), field('name-2', 'Name (2)'), field('phone-2', 'Phone (2)'), field('name-3', 'Name (3)'), field('phone-3', 'Phone (3)'), field('property-code', 'Property Code'), field('address', 'Property Address')],
    sections: [
      { id: 'setup', label: 'SET-UP CHECKLIST', column: 'left', rows: [
        task('pending-marketing', 'Pending Application to Marketing', 'intake'), task('calls', 'Calls to Applicant', 'intake'),
        field('movein-scheduled', 'Move-In Scheduled for', 'date', 'intake', true), task('tracking-sheet', 'Add to Advertising Tracking Sheet', 'intake'),
        task('hud-golden', 'HUD Client — Request Golden Key (if applicable)', 'intake'), task('hud-followup', 'HUD Follow Up Activity for Inspection Date (if applicable)', 'intake'),
        task('tenant-page', 'Create TNT Page / Attach Eval Sheet TNT Page', 'intake'), task('disable-payments', 'Unclick “Allow Online Payments”', 'intake'),
        task('charge-deposit', 'Charge / Send Deposit to Hold', 'intake'), task('info-form', 'Send Information Form', 'intake'),
        task('welcome-email', 'Send Welcome Email', 'intake'), task('inspection-activity', 'Set up “Activity” — New TNT Inspection Form', 'intake'),
        task('folders', 'Create Tenant Folders', 'intake'), task('ccrs', 'Email CCRs to Tenant', 'intake'),
        task('deposit-info', 'Deposit to Hold / Info Form Rec’d', 'intake'), task('rentzap-deactivate', 'Deactivate Link in Rentzap', 'intake'),
        task('unpost', 'Unpost Property / Remove App Pending', 'intake'), task('deposit-funds', 'Deposit to Hold Funds to Accounting', 'funds'),
        yesNo('assistance-pet', 'Assistance Pet', 'lease'), yesNo('pet-addendum', 'Pet Addendum', 'lease'),
        task('utility-addendum', 'Utility Addendum (if applicable)', 'lease'), task('rental-agreement', 'Rental Agreement Prepared & Sent', 'lease'),
        task('movein-letter', 'Move-In Information LTR Sent', 'lease'), task('owner-movein-letter', 'Send Owner Move-In Date Letter', 'lease'),
      ] },
      { id: 'movein', label: 'MOVE-IN', column: 'right', rows: [
        task('new-keys', 'New Keys Received', 'movein'), task('insurance', 'Enter Tenant Insurance Info.', 'movein'),
        field('security-deposit', 'Security Deposit', 'money', 'movein'), field('additional-deposit', 'Additional Deposit', 'money', 'movein'), field('total-deposits', 'TOTAL DEPOSITS', 'money', 'movein'),
        field('due-hold', 'DUE AT MOVE-IN — Deposit to Hold', 'money', 'movein'), field('due-security', 'Security Deposit Due', 'money', 'movein'),
        field('due-prorated', 'Prorated Rent', 'money', 'movein'), field('second-rent', '2nd Month’s Rent', 'money', 'movein'),
        field('animal-rent', 'Animal Rent', 'money', 'movein'), field('second-animal', '2nd Mth Animal Rent', 'money', 'movein'), field('rent-total', 'RENT TOTAL', 'money', 'movein'),
      ] },
      { id: 'after', label: 'AFTER MOVE-IN', column: 'right', rows: [
        task('enable-payments', 'Click “Allow Online Payments”', 'payments'), task('change-inspection', 'Change Date of Property Inspection', 'filing'),
        task('renewal-activity', 'Set Activity — Contact Owner Re Rent Increase / Renewals 120 days', 'filing'),
        task('delete-rentzap', 'Delete Rent Zap Application Link', 'filing'), task('delete-craigslist', 'Delete Craigslist', 'filing'),
        task('tenant-inspection-form', 'Send TNT Inspection Form', 'filing'), task('scan-documents', 'Scan & Attach all Docs to Tenant Pg.', 'filing'),
      ] },
    ],
    assignments: [
      { id: 'intake', label: 'Prepare tenant set-up', section: 'setup', owner: 'alex', needs: [] },
      { id: 'funds', label: 'Confirm deposit handoff', section: 'setup', owner: 'morgan', needs: ['intake'] },
      { id: 'lease', label: 'Prepare agreement and move-in letters', section: 'setup', owner: 'sam', needs: ['funds'] },
      { id: 'movein', label: 'Complete move-in details', section: 'movein', owner: 'alex', needs: ['lease'] },
      { id: 'payments', label: 'Enable online payments', section: 'after', owner: 'morgan', needs: ['movein'] },
      { id: 'filing', label: 'Finish after-move-in records', section: 'after', owner: 'alex', needs: ['movein'] },
    ],
  },
};
export type Stamp = { actor: Person; at: string; outcome: 'done' | 'na'; reason?: string };
export type AssignmentState = { owner: Person; due: string; released?: Stamp; waiting?: { reason: string; followUp: string } };
export type WorkOrder = { id: string; description: string; completed?: Stamp };
export type HistoryEntry = { id: string; actor: Person; at: string; text: string };
export type Sheet = { id: string; kind: FormKind; workflowOwner: Person; values: Record<string, string>; tasks: Record<string, Stamp>; assignments: Record<string, AssignmentState>; notes: HistoryEntry[]; workOrders: WorkOrder[]; history: HistoryEntry[] };
export type Status = 'ready' | 'waiting' | 'upcoming' | 'done';
export const allRows = (kind: FormKind) => [...TEMPLATES[kind].header, ...TEMPLATES[kind].sections.flatMap(s => s.rows)];
export const assignmentRows = (sheet: Sheet, id: string) => allRows(sheet.kind).filter(r => r.assignment === id);
export function assignmentStatus(sheet: Sheet, id: string): Status {
  if (sheet.assignments[id].released) return 'done';
  const def = TEMPLATES[sheet.kind].assignments.find(a => a.id === id)!;
  if (!def.needs.every(n => sheet.assignments[n].released)) return 'upcoming';
  return sheet.assignments[id].waiting ? 'waiting' : 'ready';
}
export function releaseIssues(sheet: Sheet, id: string): string[] {
  const issues: string[] = [];
  for (const row of assignmentRows(sheet, id)) {
    const value = sheet.values[row.id]?.trim();
    if (row.type === 'task' && !sheet.tasks[row.id]) issues.push(row.label);
    if (row.required && !value) issues.push(row.label);
    if (row.required && value && (row.type === 'money' || row.type === 'number') && (!Number.isFinite(Number(value)) || Number(value) < 0 || (row.id === 'listing-rent' && Number(value) === 0))) issues.push(row.label);
  }
  if (id === 'turn-work' && sheet.workOrders.some(w => !w.completed)) issues.push('Finish the open work orders');
  return issues;
}
export function nextAssignments(sheet: Sheet, id: string) {
  return TEMPLATES[sheet.kind].assignments.filter(a => a.needs.includes(id));
}
export function visibleInbox(sheets: Sheet[], person: Person, status: Status) {
  return sheets.flatMap(sheet => TEMPLATES[sheet.kind].assignments
    .filter(a => sheet.assignments[a.id].owner === person && assignmentStatus(sheet, a.id) === status)
    .map(assignment => ({ sheet, assignment })))
    .sort((a, b) => (a.sheet.assignments[a.assignment.id].due || '9999').localeCompare(b.sheet.assignments[b.assignment.id].due || '9999') || a.sheet.id.localeCompare(b.sheet.id));
}
function event(sheet: Sheet, actor: Person, at: string, text: string): HistoryEntry {
  return { id: `${sheet.id}-${sheet.history.length}-${at}`, actor, at, text };
}
export function completeTask(sheet: Sheet, taskId: string, actor: Person, at: string, outcome: 'done' | 'na' = 'done', reason = ''): Sheet {
  const row = allRows(sheet.kind).find(r => r.id === taskId && r.type === 'task');
  if (!row?.assignment || sheet.tasks[taskId] || sheet.assignments[row.assignment].owner !== actor || assignmentStatus(sheet, row.assignment) !== 'ready') return sheet;
  if (outcome === 'na' && !reason.trim()) return sheet;
  return { ...sheet, tasks: { ...sheet.tasks, [taskId]: { actor, at, outcome, ...(reason.trim() ? { reason: reason.trim() } : {}) } }, history: [...sheet.history, event(sheet, actor, at, `${outcome === 'done' ? 'Completed' : 'Marked not applicable'}: ${row.label}${reason.trim() ? ' — ' + reason.trim() : ''}`)] };
}
export function undoTask(sheet: Sheet, taskId: string, actor: Person, at: string): Sheet {
  const row = allRows(sheet.kind).find(r => r.id === taskId);
  if (!row?.assignment || !sheet.tasks[taskId] || sheet.assignments[row.assignment].owner !== actor || sheet.assignments[row.assignment].released) return sheet;
  const tasks = { ...sheet.tasks }; delete tasks[taskId];
  return { ...sheet, tasks, history: [...sheet.history, event(sheet, actor, at, `Corrected completion: ${row.label}`)] };
}
export function editField(sheet: Sheet, fieldId: string, value: string, actor: Person): Sheet {
  const row = allRows(sheet.kind).find(r => r.id === fieldId && r.type !== 'task');
  if (!row || (row.assignment ? sheet.assignments[row.assignment].owner !== actor || !!sheet.assignments[row.assignment].released : sheet.workflowOwner !== actor)) return sheet;
  return { ...sheet, values: { ...sheet.values, [fieldId]: value } };
}
export function releaseAssignment(sheet: Sheet, id: string, actor: Person, at: string): Sheet {
  if (!sheet.assignments[id] || sheet.assignments[id].owner !== actor || assignmentStatus(sheet, id) !== 'ready' || releaseIssues(sheet, id).length) return sheet;
  const def = TEMPLATES[sheet.kind].assignments.find(a => a.id === id)!;
  const recipients = nextAssignments(sheet, id).map(a => `${PEOPLE[sheet.assignments[a.id].owner].name} (${a.label})`);
  return { ...sheet, assignments: { ...sheet.assignments, [id]: { ...sheet.assignments[id], released: { actor, at, outcome: 'done' } } }, history: [...sheet.history, event(sheet, actor, at, `${def.label} released${recipients.length ? ' → ' + recipients.join('; ') : ' — assignment finished'}`)] };
}
export function setWaiting(sheet: Sheet, id: string, actor: Person, reason: string, followUp: string, at: string): Sheet {
  if (!reason.trim() || !followUp || assignmentStatus(sheet, id) !== 'ready' || sheet.assignments[id].owner !== actor) return sheet;
  return { ...sheet, assignments: { ...sheet.assignments, [id]: { ...sheet.assignments[id], waiting: { reason: reason.trim(), followUp } } }, history: [...sheet.history, event(sheet, actor, at, `Waiting: ${reason.trim()} · Follow up ${followUp}`)] };
}
export function resumeAssignment(sheet: Sheet, id: string, actor: Person, at: string): Sheet {
  if (assignmentStatus(sheet, id) !== 'waiting' || sheet.assignments[id].owner !== actor) return sheet;
  return { ...sheet, assignments: { ...sheet.assignments, [id]: { ...sheet.assignments[id], waiting: undefined } }, history: [...sheet.history, event(sheet, actor, at, `Resumed: ${TEMPLATES[sheet.kind].assignments.find(a => a.id === id)!.label}`)] };
}
export function reassign(sheet: Sheet, id: string, owner: Person, actor: Person, at: string): Sheet {
  if (actor !== sheet.workflowOwner || !sheet.assignments[id] || sheet.assignments[id].released || sheet.assignments[id].owner === owner) return sheet;
  return { ...sheet, assignments: { ...sheet.assignments, [id]: { ...sheet.assignments[id], owner } }, history: [...sheet.history, event(sheet, actor, at, `Reassigned ${TEMPLATES[sheet.kind].assignments.find(a => a.id === id)!.label}: ${PEOPLE[sheet.assignments[id].owner].name} → ${PEOPLE[owner].name}`)] };
}
export function addNote(sheet: Sheet, text: string, actor: Person, at: string): Sheet {
  if (!text.trim()) return sheet;
  const note = event(sheet, actor, at, text.trim());
  return { ...sheet, notes: [...sheet.notes, note], history: [...sheet.history, event(sheet, actor, at, 'Added a note on the back')] };
}
export function addWorkOrder(sheet: Sheet, description: string, actor: Person, at: string): Sheet {
  if (sheet.kind !== 'vacancy' || !description.trim() || (actor !== sheet.workflowOwner && actor !== sheet.assignments.inspection.owner) || sheet.assignments['turn-work'].released) return sheet;
  const workOrder: WorkOrder = { id: `DEMO-${sheet.id}-${sheet.workOrders.length + 1}`, description: description.trim() };
  return { ...sheet, workOrders: [...sheet.workOrders, workOrder], history: [...sheet.history, event(sheet, actor, at, `Added work order: ${workOrder.description}`)] };
}
export function completeWorkOrder(sheet: Sheet, id: string, actor: Person, at: string): Sheet {
  if (sheet.kind !== 'vacancy' || sheet.assignments['turn-work'].owner !== actor || assignmentStatus(sheet, 'turn-work') !== 'ready' || !sheet.workOrders.some(w => w.id === id && !w.completed)) return sheet;
  return { ...sheet, workOrders: sheet.workOrders.map(w => w.id === id ? { ...w, completed: { actor, at, outcome: 'done' } } : w), history: [...sheet.history, event(sheet, actor, at, `Completed work order: ${id}`)] };
}
export function localDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function createExamples(now = new Date()): Sheet[] {
  const day = (offset: number) => { const d = new Date(localDay(now) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
  const make = (id: string, kind: FormKind, address: string): Sheet => ({ id, kind, workflowOwner: 'alex', values: { names: 'Example Tenant', address, 'property-code': id, city: 'Example City, OR', 'submitted-date': day(-2), 'inspection-date': day(21), prorated: '0', 'notice-date': day(-3), 'projected-moveout': day(20), 'owner-name': 'Example Owner', 'owner-notified': day(-1), 'owner-initial': 'Sam', 'listing-rent': '1850', availability: day(25), term: '12 Month', 'washer-dryer': 'Yes', 'landscape-contract': 'No', 'wsg': 'No', 'water-sewer': 'Yes', 'landscaping-paid': 'No', pets: 'Yes', 'movein-scheduled': day(3), 'movein-appointment': day(3), 'lease-type': 'Fixed Term', 'lease-months': '12' }, tasks: {}, assignments: Object.fromEntries(TEMPLATES[kind].assignments.map((a, i) => [a.id, { owner: a.owner, due: i < 3 ? day(i === 1 ? 0 : 1) : '' }])), notes: [], workOrders: [], history: [] });
  const seed = (sheet: Sheet, id: string) => {
    const actor = sheet.assignments[id].owner;
    for (const row of assignmentRows(sheet, id)) if (row.type === 'task') sheet.tasks[row.id] = { actor, at: 'Example starting record', outcome: 'done' };
    sheet.assignments[id].released = { actor, at: 'Example starting record', outcome: 'done' };
  };
  const first = make('VT-104', 'vacancy', '123 Example Lane · Unit 4'); seed(first, 'notice');
  first.tasks['landscaper-email'] = { actor: 'sam', at: 'Example starting record', outcome: 'na', reason: 'No landscaping contract in this example' };
  first.assignments.keys.waiting = { reason: 'Waiting for tenant to return keys', followUp: day(19) };
  const second = make('VT-105', 'vacancy', '789 Sample Court · Unit 1'); seed(second, 'notice'); seed(second, 'owner'); seed(second, 'advertising'); seed(second, 'keys'); seed(second, 'inspection');
  second.values = { ...second.values, 'keys-returned': day(-2), 'key-channel': 'HD', 'keys-receiver': 'Alex', 'actual-moveout': day(-2), 'house-keys': '2', 'mail-keys': '1', 'inspection-date': day(-1) };
  second.workOrders = [{ id: 'DEMO-VT-105-1', description: 'Replace damaged bedroom blinds' }, { id: 'DEMO-VT-105-2', description: 'Touch up bedroom paint' }];
  second.assignments.closeout.waiting = { reason: 'Awaiting invoice details; accounting follow-up remains assigned', followUp: day(1) };
  const third = make('NT-202', 'setup', '456 Sample Street · Unit 2'); seed(third, 'intake'); seed(third, 'funds');
  third.tasks['utility-addendum'] = { actor: 'sam', at: 'Example starting record', outcome: 'na', reason: 'No addendum needed in this example' };
  return [first, second, third];
}
