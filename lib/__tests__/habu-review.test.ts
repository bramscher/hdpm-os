import { describe, it, expect, vi } from 'vitest';
import { addDays, newReview, scheduleProposal, reviewExamples, inbox, targetDate, timing } from '@/lib/habu-paper/review';
import { releaseAssignment, completeTask, TEMPLATES } from '@/lib/habu-paper/model';
const day = '2026-09-10';
describe('turn schedule', () => {
  it('counts next day as Day 1 across weekends, holidays, year end and DST', () => {
    expect(addDays(day, 10)).toBe('2026-09-20');
    expect(addDays('2026-12-24', 10)).toBe('2027-01-03');
    expect(addDays('2026-03-07', 10)).toBe('2026-03-17');
    expect(addDays('2026-02-30', 10)).toBe('');
  });
  it('proposes Day 1 inspection, Day 8 work, Day 10 verification without changing accounting or completed dates', () => {
    const s = newReview('test', 'Example', day);
    s.assignments.closeout.due = '2026-10-01';
    s.assignments.keys.released = { actor: 'alex', at: 'sample', outcome: 'done' };
    s.assignments.keys.due = '2026-09-09';
    const p = scheduleProposal(s, day, 'standard', '', '')!;
    expect(targetDate(p)).toBe('2026-09-20');
    expect(p.assignments.inspection.due).toBe('2026-09-11');
    expect(p.assignments['turn-work'].due).toBe('2026-09-18');
    expect(p.assignments.verify.due).toBe('2026-09-20');
    expect(p.assignments.keys.due).toBe('2026-09-09');
    expect(p.assignments.closeout.due).toBe('2026-10-01');
    expect(s.values['keys-returned']).toBeUndefined();
  });
  it('only extends for a remodel with a reason and a later valid target', () => {
    const s = newReview('test', 'Example', day);
    expect(scheduleProposal(s, day, 'remodel', '2026-09-25', '')).toBeNull();
    expect(scheduleProposal(s, day, 'remodel', '2026-09-19', 'Kitchen')).toBeNull();
    const p = scheduleProposal(s, day, 'remodel', '2026-10-10', 'Kitchen remodel')!;
    expect(p.assignments['turn-work'].due).toBe('2026-10-08');
    expect(targetDate(p)).toBe('2026-10-10');
  });
});
describe('role inbox and handoff', () => {
  it('releases owner and keys concurrently from Front Desk, but keeps inspection blocked', () => {
    let s = newReview('test', 'Example', day);
    for (const row of TEMPLATES.vacancy.sections.flatMap(s => s.rows).filter(r => r.assignment === 'notice' && r.type === 'task')) s = { ...s, ...completeTask(s, row.id, 'alex', '2026-09-10T20:00:00Z') };
    s = { ...s, ...releaseAssignment(s, 'notice', 'alex', '2026-09-10T20:00:00Z') };
    expect(inbox([s], 'sam', 'ready', day).map(v => v.stage.id)).toEqual(['owner']);
    expect(inbox([s], 'alex', 'ready', day).map(v => v.stage.id)).toEqual(['keys']);
    expect(inbox([s], 'sam', 'upcoming', day).map(v => v.stage.id)).toContain('inspection');
    expect(releaseAssignment(s, 'notice', 'alex', 'later')).toBe(s);
  });
  it('prioritizes urgency then due dates and flags blocked delays separately', () => {
    const s = newReview('a', 'Example', day), other = newReview('b', 'Example 2', day);
    s.assignments.notice.due = '2026-09-01'; other.priority = 'Urgent';
    expect(inbox([s, other], 'alex', 'ready', day).map(v => v.sheet.id)).toEqual(['b', 'a']);
    s.assignments.inspection.due = '2026-09-09';
    expect(timing(s, 'inspection', day)).toBe('At risk · prerequisite late');
    expect(timing(s, 'notice', day)).toBe('Overdue');
  });
  it('uses four roles, and the maintenance handoff makes verification ready', () => {
    const examples = reviewExamples(new Date('2026-09-10T20:00:00Z'));
    expect(examples.flatMap(s => Object.values(s.assignments).map(a => a.owner))).not.toContain('jordan');
    let s = examples[1];
    expect(releaseAssignment(s, 'turn-work', 'taylor', 'sample')).toBe(s);
    s = { ...s, workOrders: s.workOrders.map(w => ({ ...w, completed: { actor: 'taylor', at: 'sample', outcome: 'done' } })) };
    s = { ...s, ...releaseAssignment(s, 'turn-work', 'taylor', '2026-09-10T20:00:00Z') };
    expect(inbox([s], 'sam', 'ready', day).map(v => v.stage.id)).toContain('verify');
  });
});

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/app/admin/habu-paper/workflows/workflow-review', () => ({ default: () => null }));
import { auth } from '@/lib/auth';
import WorkflowPage from '@/app/admin/habu-paper/workflows/page';
describe('workflow review access', () => {
  it.each([null, { user: { email: 'someone@highdesertpm.com', role: 'admin' } }, { user: { email: 'craig@highdesertpm.com', role: 'staff' } }])('rejects non-owner sessions', async session => {
    vi.mocked(auth).mockResolvedValue(session as never);
    await expect(WorkflowPage()).rejects.toThrow('NOT_FOUND');
  });
  it('allows Craig as admin', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { email: 'craig@highdesertpm.com', role: 'admin' } } as never);
    expect(await WorkflowPage()).toBeTruthy();
  });
});
