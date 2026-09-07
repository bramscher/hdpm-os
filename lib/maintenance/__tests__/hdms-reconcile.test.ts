import { describe, it, expect } from 'vitest';
import {
  categorizeHdmsReconciliation,
  isWorkOrderDone,
  isWorkOrderCanceled,
  PRE_LAUNCH_CUTOFF,
  type HdmsReconWorkOrder,
  type HdmsReconInvoice,
} from '../hdms-reconcile-shared';

function wo(overrides: Partial<HdmsReconWorkOrder> & { id: string }): HdmsReconWorkOrder {
  return {
    wo_number: null,
    unit_name: null,
    property_name: null,
    description: null,
    appfolio_status: 'Assigned',
    status: 'open',
    stage: 'NEW',
    assigned_to: null,
    assigned_tech: null,
    owner_name: 'Penny',
    vendor_name: 'High Desert Maintenance Services - Division of HDPM',
    completed_date: null,
    canceled_date: null,
    verified_at: null,
    appfolio_link: null,
    ...overrides,
  };
}

function inv(overrides: Partial<HdmsReconInvoice> & { id: string }): HdmsReconInvoice {
  return {
    invoice_code: 'HDMS-INV-000001',
    status: 'generated',
    doc_type: 'invoice',
    total_amount: 100,
    work_order_id: null,
    wo_reference: null,
    ...overrides,
  };
}

describe('done / canceled predicates', () => {
  it('treats AppFolio-Completed as done', () => {
    expect(isWorkOrderDone(wo({ id: 'a', appfolio_status: 'Completed' }))).toBe(true);
  });
  it('treats HDPM-verified as done even when AppFolio is not Completed', () => {
    expect(isWorkOrderDone(wo({ id: 'a', appfolio_status: 'Assigned', verified_at: '2026-09-01' }))).toBe(true);
    expect(isWorkOrderDone(wo({ id: 'a', appfolio_status: 'Assigned', stage: 'VERIFY' }))).toBe(true);
  });
  it('treats AppFolio "Work Completed" and "Closed" as done', () => {
    expect(isWorkOrderDone(wo({ id: 'a', appfolio_status: 'Work Completed' }))).toBe(true);
    expect(isWorkOrderDone(wo({ id: 'a', appfolio_status: 'Closed' }))).toBe(true);
    expect(isWorkOrderDone(wo({ id: 'a', appfolio_status: 'Assigned', status: 'done' }))).toBe(true);
  });
  it('an open assigned WO is not done', () => {
    expect(isWorkOrderDone(wo({ id: 'a' }))).toBe(false);
  });
  it('detects canceled by status or date', () => {
    expect(isWorkOrderCanceled(wo({ id: 'a', appfolio_status: 'Canceled' }))).toBe(true);
    expect(isWorkOrderCanceled(wo({ id: 'a', canceled_date: '2026-08-01' }))).toBe(true);
  });
});

describe('categorizeHdmsReconciliation', () => {
  it('buckets each of the five states', () => {
    const wos: HdmsReconWorkOrder[] = [
      wo({ id: 'done-billed', wo_number: '100-1', appfolio_status: 'Completed', completed_date: '2026-09-01' }),
      wo({ id: 'done-unbilled', wo_number: '200-1', appfolio_status: 'Completed', completed_date: '2026-09-02' }),
      wo({ id: 'not-done', wo_number: '300-1', appfolio_status: 'Assigned' }),
      wo({ id: 'premature', wo_number: '400-1', appfolio_status: 'Assigned' }),
      wo({ id: 'canceled', wo_number: '500-1', appfolio_status: 'Canceled', canceled_date: '2026-08-20' }),
    ];
    const invoices: HdmsReconInvoice[] = [
      inv({ id: 'i1', work_order_id: 'done-billed', total_amount: 250 }),
      inv({ id: 'i2', work_order_id: 'premature', total_amount: 90 }),
    ];

    const r = categorizeHdmsReconciliation(wos, invoices);
    const byWo = new Map(r.rows.filter((x) => x.wo_id).map((x) => [x.wo_id, x.category]));
    expect(byWo.get('done-billed')).toBe('done_billed');
    expect(byWo.get('done-unbilled')).toBe('done_unbilled');
    expect(byWo.get('not-done')).toBe('not_done');
    expect(byWo.get('premature')).toBe('billed_not_done');
    expect(byWo.get('canceled')).toBe('canceled');

    expect(r.summary.done_billed).toEqual({ count: 1, invoicedTotal: 250 });
    expect(r.summary.done_unbilled.count).toBe(1);
    expect(r.summary.billed_not_done.count).toBe(1);
  });

  it('matches an invoice by wo_reference when work_order_id is null', () => {
    const wos = [wo({ id: 'w1', wo_number: '77-1', appfolio_status: 'Completed', completed_date: '2026-09-01' })];
    const invoices = [inv({ id: 'i1', work_order_id: null, wo_reference: '77-1' })];
    const r = categorizeHdmsReconciliation(wos, invoices);
    expect(r.rows[0].category).toBe('done_billed');
    expect(r.rows[0].invoice_code).toBe('HDMS-INV-000001');
  });

  it('ignores void invoices and credit memos when deciding "billed"', () => {
    const wos = [wo({ id: 'w1', wo_number: '88-1', appfolio_status: 'Completed', completed_date: '2026-09-01' })];
    const invoices = [
      inv({ id: 'void', work_order_id: 'w1', status: 'void' }),
      inv({ id: 'credit', work_order_id: 'w1', doc_type: 'credit' }),
    ];
    const r = categorizeHdmsReconciliation(wos, invoices);
    // The WO row should read as done-unbilled; neither void nor credit counts.
    const woRow = r.rows.find((x) => x.wo_id === 'w1');
    expect(woRow?.category).toBe('done_unbilled');
  });

  it('flags pre-launch completions (grandfathered) via pre_launch', () => {
    const wos = [
      wo({ id: 'old', wo_number: '1-1', appfolio_status: 'Completed', completed_date: '2026-05-15' }),
      wo({ id: 'new', wo_number: '2-1', appfolio_status: 'Completed', completed_date: '2026-08-15' }),
    ];
    const r = categorizeHdmsReconciliation(wos, []);
    const byWo = new Map(r.rows.map((x) => [x.wo_id, x]));
    expect(PRE_LAUNCH_CUTOFF).toBe('2026-07-01');
    expect(byWo.get('old')?.pre_launch).toBe(true);
    expect(byWo.get('new')?.pre_launch).toBe(false);
    // Both are the same leak category; pre_launch is an orthogonal flag.
    expect(byWo.get('old')?.category).toBe('done_unbilled');
    expect(byWo.get('new')?.category).toBe('done_unbilled');
  });

  it('surfaces an orphan invoice with no matching WO as billed_not_done', () => {
    const wos = [wo({ id: 'w1', wo_number: '10-1', appfolio_status: 'Completed', completed_date: '2026-09-01' })];
    const invoices = [
      inv({ id: 'i1', work_order_id: 'w1' }),
      inv({ id: 'orphan', work_order_id: 'ghost', wo_reference: '999-9', invoice_code: 'HDMS-INV-000999' }),
    ];
    const r = categorizeHdmsReconciliation(wos, invoices);
    const orphan = r.rows.find((x) => x.invoice_code === 'HDMS-INV-000999');
    expect(orphan?.category).toBe('billed_not_done');
    expect(orphan?.wo_number).toBe('999-9');
    expect(r.summary.billed_not_done.count).toBe(1);
  });
});
