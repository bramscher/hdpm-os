import { describe, expect, it } from 'vitest';
import { homeRouteSummary } from '../route-summary';

describe('homeRouteSummary', () => {
  it('keeps who, where and when, and drops the door notes and office notes', () => {
    const loaded = {
      id: 'r1', route_date: '2026-10-21', assigned_tech: 'Alberto', start_time: '07:30:00', notes: 'Garage code 4321',
      total_drive_minutes: 40, total_service_minutes: 120, stop_count: 1, notify_log: [{ channel: 'text' }],
      stops: [{
        work_order_id: 'wo-1', stop_order: 1, address: '3602 SW Badger Ave', lat: 44.25, lng: -121.19, arrival: '2026-10-21T14:45:00.000Z',
        details: { entry_instructions: 'Lockbox 1234 on the back door', tenant_remarks: 'Dog in yard' },
        work_orders: { wo_number: '43280-1', property_name: 'Weinberger 284', unit_name: null, description: 'Remove TV mount' },
      }],
    };
    const summary = homeRouteSummary(loaded);
    expect(summary).toEqual({
      id: 'r1', route_date: '2026-10-21', assigned_tech: 'Alberto', start_time: '07:30',
      total_drive_minutes: 40, total_service_minutes: 120, stop_count: 1,
      stops: [{
        work_order_id: 'wo-1', stop_order: 1, address: '3602 SW Badger Ave', lat: 44.25, lng: -121.19, arrival: '2026-10-21T14:45:00.000Z',
        work_orders: { wo_number: '43280-1', property_name: 'Weinberger 284', unit_name: null },
      }],
    });
    expect(JSON.stringify(summary)).not.toMatch(/Lockbox|Dog|Garage|TV mount/);
  });
});
