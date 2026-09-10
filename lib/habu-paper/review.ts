import { TEMPLATES, assignmentStatus, createExamples, localDay, type Sheet, type Person } from './model';

export const ROLES: Partial<Record<Person, string>> = { alex: 'Front Desk', sam: 'Property Manager', taylor: 'Maintenance', morgan: 'Accounting' };
export const STAGES = TEMPLATES.vacancy.assignments;
export type ReviewSheet = Sheet & { priority: 'Normal' | 'High' | 'Urgent'; schedule: { mode: 'standard' | 'remodel'; target: string; reason: string }; };
export function addDays(day: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const date = new Date(day + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function targetDate(sheet: ReviewSheet) {
  return sheet.schedule.mode === 'remodel' ? sheet.schedule.target : addDays(sheet.values['keys-returned'] || '', 10);
}
export function scheduleProposal(sheet: ReviewSheet, keys: string, mode: 'standard' | 'remodel', target: string, reason: string): ReviewSheet | null {
  const standard = addDays(keys, 10);
  if (!standard || (mode === 'remodel' && (!addDays(target, 0) || target <= standard || !reason.trim()))) return null;
  const end = mode === 'standard' ? standard : target;
  const dates: Record<string, string> = { keys, inspection: addDays(keys, 1), 'turn-work': addDays(end, -2), verify: end };
  return { ...sheet, values: { ...sheet.values, 'keys-returned': keys }, schedule: { mode, target: end, reason: mode === 'remodel' ? reason.trim() : '' }, assignments: Object.fromEntries(Object.entries(sheet.assignments).map(([id, a]) => [id, { ...a, due: !a.released && dates[id] ? dates[id] : a.due }])) };
}
export function timing(sheet: ReviewSheet, id: string, today: string) {
  const state = assignmentStatus(sheet, id), due = sheet.assignments[id].due;
  if (state === 'done') return 'Completed';
  if (!due) return 'Date to set';
  if (due < today) return state === 'upcoming' ? 'At risk · prerequisite late' : 'Overdue';
  return due === today ? 'Due today' : 'Scheduled';
}
export function inbox(sheets: ReviewSheet[], role: Person, status: string, today: string) {
  const rank = { Urgent: 0, High: 1, Normal: 2 };
  return sheets.flatMap(sheet => STAGES.filter(a => sheet.assignments[a.id].owner === role && assignmentStatus(sheet, a.id) === status).map(stage => ({ sheet, stage })))
    .sort((a, b) => {
      const aa = a.sheet.assignments[a.stage.id], bb = b.sheet.assignments[b.stage.id];
      const ad = status === 'waiting' ? aa.waiting?.followUp || aa.due : aa.due;
      const bd = status === 'waiting' ? bb.waiting?.followUp || bb.due : bb.due;
      return rank[a.sheet.priority] - rank[b.sheet.priority] || Number(!!bd && bd < today) - Number(!!ad && ad < today) || (ad || '9999').localeCompare(bd || '9999');
    });
}
export function reviewExamples(now = new Date()): ReviewSheet[] {
  const today = localDay(now);
  const [a, b] = createExamples(now).filter(s => s.kind === 'vacancy');
  const convert = (s: Sheet): ReviewSheet => ({ ...s, assignments: Object.fromEntries(Object.entries(s.assignments).map(([id, v]) => [id, { ...v, owner: v.owner === 'jordan' ? 'alex' : v.owner }])), priority: 'Normal', schedule: { mode: 'standard', target: '', reason: '' } });
  const first = convert(a); first.assignments.keys.waiting!.followUp = addDays(today, 2);
  const second = scheduleProposal(convert(b), addDays(today, -4), 'standard', '', '')!;
  second.assignments['turn-work'].due = addDays(today, -1); second.priority = 'High';
  second.assignments.closeout.due = ''; // Accounting is separate from the property-ready target.
  second.values['keys-receiver'] = 'Front Desk';
  const third = newReview('VT-106', '456 Demo Avenue · Unit 2', today);
  return [first, second, third];
}
export function newReview(id: string, address: string, today: string): ReviewSheet {
  return { id, kind: 'vacancy', workflowOwner: 'alex', values: { address, 'property-code': id, 'notice-date': today }, tasks: {}, assignments: Object.fromEntries(STAGES.map(a => [a.id, { owner: a.owner === 'jordan' ? 'alex' : a.owner, due: a.id === 'notice' ? today : '' }])), notes: [], workOrders: [], history: [], priority: 'Normal', schedule: { mode: 'standard', target: '', reason: '' } };
}
