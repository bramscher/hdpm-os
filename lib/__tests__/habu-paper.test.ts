import { describe, expect, it, vi } from 'vitest';
import { TEMPLATES, localDay, allRows, createExamples, assignmentStatus, releaseIssues, visibleInbox, completeTask, undoTask, editField, releaseAssignment, setWaiting, resumeAssignment, reassign, addWorkOrder, completeWorkOrder } from '@/lib/habu-paper/model';

const timestamp = '2026-09-10T16:00:00.000Z';
const examples = () => createExamples(new Date(timestamp));

describe('paper templates', () => {
  it('uses the same Pacific business date on server and browser around midnight and DST', () => {
    expect(localDay(new Date('2026-09-10T02:00:00Z'))).toBe('2026-09-09');
    expect(localDay(new Date('2026-01-10T07:30:00Z'))).toBe('2026-01-09');
    expect(createExamples(new Date('2026-03-08T09:30:00Z'))[0].values['owner-notified']).toBe('2026-03-07');
  });
  it('has unique row and assignment IDs and complete ownership mappings', () => {
    for (const template of Object.values(TEMPLATES)) {
      const rows = [...template.header, ...template.sections.flatMap(s => s.rows)];
      expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
      expect(new Set(template.assignments.map(a => a.id)).size).toBe(template.assignments.length);
      for (const row of rows) if (row.assignment) expect(template.assignments.some(a => a.id === row.assignment)).toBe(true);
      const visited = new Set<string>();
      while (visited.size < template.assignments.length) {
        const next = template.assignments.filter(a => !visited.has(a.id) && a.needs.every(n => visited.has(n)));
        expect(next.length).toBeGreaterThan(0);
        next.forEach(a => visited.add(a.id));
      }
    }
  });
  it('preserves mixed paper field types rather than flattening them to checkboxes', () => {
    expect(allRows('vacancy').find(r => r.id === 'listing-rent')?.type).toBe('money');
    expect(allRows('vacancy').find(r => r.id === 'keys-returned')?.type).toBe('date');
    expect(allRows('vacancy').find(r => r.id === 'house-keys')?.type).toBe('number');
    expect(allRows('setup').find(r => r.id === 'total-deposits')?.type).toBe('money');
    expect(TEMPLATES.vacancy.sections.filter(s => s.column !== 'back').map(s => s.label)).toEqual(['TENANT', 'OWNER', 'ADVERTISING', 'VACANCY', 'CLOSE OUT TENANTS']);
  });
});

describe('one sheet, shared assignment state', () => {
  it('releases to the next inbox exactly once without changing another case', () => {
    const sheets = examples(); const original = sheets[0];
    expect(visibleInbox(sheets, 'sam', 'ready').map(i => i.assignment.id)).toEqual(expect.arrayContaining(['owner', 'lease']));
    expect(assignmentStatus(original, 'advertising')).toBe('upcoming');
    const released = releaseAssignment(original, 'owner', 'sam', timestamp);
    expect(released).not.toBe(original);
    expect(assignmentStatus(released, 'owner')).toBe('done');
    expect(assignmentStatus(released, 'advertising')).toBe('ready');
    expect(visibleInbox([released, ...sheets.slice(1)], 'jordan', 'ready').map(i => i.sheet.id)).toEqual(['VT-104']);
    expect(visibleInbox([released], 'sam', 'ready')).toHaveLength(0);
    expect(releaseAssignment(released, 'owner', 'sam', timestamp)).toBe(released);
    expect(released.history).toHaveLength(1);
    expect(sheets[1]).toEqual(examples()[1]);
    expect(original.assignments.owner.released).toBeUndefined();
  });
  it('does not release unready, incomplete, or someone else’s assignment', () => {
    const sheet = examples()[0];
    expect(releaseAssignment(sheet, 'advertising', 'jordan', timestamp)).toBe(sheet);
    expect(releaseAssignment(sheet, 'owner', 'alex', timestamp)).toBe(sheet);
    const missing = editField(sheet, 'listing-rent', '', 'sam');
    expect(releaseIssues(missing, 'owner')).toContain('Rent Amount for New Listing');
    expect(releaseAssignment(missing, 'owner', 'sam', timestamp)).toBe(missing);
    const invalid = editField(sheet, 'listing-rent', '-10', 'sam');
    expect(releaseIssues(invalid, 'owner')).toContain('Rent Amount for New Listing');
  });
  it('stamps task completion and supports a recorded correction before release', () => {
    const sheet = releaseAssignment(examples()[0], 'owner', 'sam', timestamp);
    const done = completeTask(sheet, 'af-listing', 'jordan', timestamp);
    expect(done.tasks['af-listing']).toEqual({ actor: 'jordan', at: timestamp, outcome: 'done' });
    expect(completeTask(done, 'af-listing', 'jordan', timestamp)).toBe(done);
    expect(completeTask(sheet, 'af-listing', 'sam', timestamp)).toBe(sheet);
    const corrected = undoTask(done, 'af-listing', 'jordan', timestamp);
    expect(corrected.tasks['af-listing']).toBeUndefined();
    expect(corrected.history.at(-1)?.text).toContain('Corrected completion');
  });
  it('requires a reason for N/A, and preserves that reason', () => {
    const sheet = examples()[2];
    expect(completeTask(sheet, 'rental-agreement', 'sam', timestamp, 'na')).toBe(sheet);
    const na = completeTask(sheet, 'rental-agreement', 'sam', timestamp, 'na', 'Example exception reviewed');
    expect(na.tasks['rental-agreement'].reason).toBe('Example exception reviewed');
    expect(na.tasks['rental-agreement'].outcome).toBe('na');
  });
  it('keeps waiting separate from ready and preserves its owner and follow-up', () => {
    const sheet = examples()[0];
    const waiting = setWaiting(sheet, 'owner', 'sam', 'Owner reviewing the rent', '2026-09-12', timestamp);
    expect(visibleInbox([waiting], 'sam', 'ready')).toHaveLength(0);
    expect(visibleInbox([waiting], 'sam', 'waiting')).toHaveLength(1);
    expect(waiting.assignments.owner.waiting?.followUp).toBe('2026-09-12');
    expect(releaseAssignment(waiting, 'owner', 'sam', timestamp)).toBe(waiting);
    expect(assignmentStatus(resumeAssignment(waiting, 'owner', 'sam', timestamp), 'owner')).toBe('ready');
  });
  it('moves an assignment between inboxes only through its workflow owner', () => {
    const sheet = examples()[0];
    expect(reassign(sheet, 'owner', 'jordan', 'sam', timestamp)).toBe(sheet);
    const changed = reassign(sheet, 'owner', 'jordan', 'alex', timestamp);
    expect(visibleInbox([changed], 'sam', 'ready')).toHaveLength(0);
    expect(visibleInbox([changed], 'jordan', 'ready')[0].assignment.id).toBe('owner');
    expect(changed.history[0].text).toContain('Sam → Jordan');
    expect(changed.tasks['landscaper-email'].actor).toBe('sam');
  });
  it('keeps released data immutable and rejects another person’s field edits', () => {
    const sheet = examples()[0];
    expect(editField(sheet, 'listing-rent', '999', 'jordan')).toBe(sheet);
    const released = releaseAssignment(sheet, 'owner', 'sam', timestamp);
    expect(editField(released, 'listing-rent', '999', 'sam')).toBe(released);
    expect(undoTask(released, 'landscaper-email', 'sam', timestamp)).toBe(released);
  });
  it('keeps turn work on the back and waits for open work orders before verification', () => {
    const sheet = examples()[1];
    expect(assignmentStatus(sheet, 'turn-work')).toBe('ready');
    expect(releaseAssignment(sheet, 'turn-work', 'taylor', timestamp)).toBe(sheet);
    const expanded = addWorkOrder(sheet, 'Clean the kitchen', 'sam', timestamp);
    expect(expanded.workOrders).toHaveLength(3);
    const done = expanded.workOrders.reduce((s, w) => completeWorkOrder(s, w.id, 'taylor', timestamp), expanded);
    const released = releaseAssignment(done, 'turn-work', 'taylor', timestamp);
    expect(assignmentStatus(released, 'verify')).toBe('ready');
    expect(released.assignments.closeout.waiting).toEqual(sheet.assignments.closeout.waiting);
    expect(addWorkOrder(released, 'Late change', 'sam', timestamp)).toBe(released);
  });
});

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/app/admin/habu-paper/paper-demo', () => ({ default: () => null }));
import { auth } from '@/lib/auth';
import PaperWorkflowPage from '@/app/admin/habu-paper/page';
describe('paper demo server guard', () => {
  it.each([null, { user: { email: 'someone@highdesertpm.com', role: 'admin' } }, { user: { email: 'craig@highdesertpm.com', role: 'staff' } }])('denies non-owner access', async session => {
    vi.mocked(auth).mockResolvedValue(session as never);
    await expect(PaperWorkflowPage()).rejects.toThrow('NOT_FOUND');
  });
  it('allows Craig with an admin session', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { email: 'craig@highdesertpm.com', role: 'admin' } } as never);
    expect(await PaperWorkflowPage()).toBeTruthy();
  });
});
