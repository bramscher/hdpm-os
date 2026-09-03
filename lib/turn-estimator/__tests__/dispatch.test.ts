import { describe, it, expect } from 'vitest';
import { mapWorkOrdersToTurnStatus } from '@/lib/turn-estimator/dispatch';

describe('mapWorkOrdersToTurnStatus', () => {
  it('no WOs → null (leave the turn alone)', () => {
    expect(mapWorkOrdersToTurnStatus([])).toBeNull();
  });
  it('only NEW/TRIAGED → null (not scheduled yet)', () => {
    expect(mapWorkOrdersToTurnStatus(['NEW', 'TRIAGED'])).toBeNull();
  });
  it('any SCHEDULED (none started) → SCHEDULED', () => {
    expect(mapWorkOrdersToTurnStatus(['NEW', 'SCHEDULED'])).toBe('SCHEDULED');
  });
  it('any IN_PROGRESS or WAITING_ON → IN_PROGRESS', () => {
    expect(mapWorkOrdersToTurnStatus(['SCHEDULED', 'IN_PROGRESS'])).toBe('IN_PROGRESS');
    expect(mapWorkOrdersToTurnStatus(['SCHEDULED', 'WAITING_ON'])).toBe('IN_PROGRESS');
  });
  it('any VERIFY (nothing still in progress) → QC_PENDING', () => {
    expect(mapWorkOrdersToTurnStatus(['VERIFY', 'CLOSED'])).toBe('QC_PENDING');
  });
  it('in-progress beats verify (still active work)', () => {
    expect(mapWorkOrdersToTurnStatus(['IN_PROGRESS', 'VERIFY'])).toBe('IN_PROGRESS');
  });
  it('all BILL/CLOSED → TURN_READY', () => {
    expect(mapWorkOrdersToTurnStatus(['CLOSED', 'CLOSED'])).toBe('TURN_READY');
    expect(mapWorkOrdersToTurnStatus(['BILL', 'CLOSED'])).toBe('TURN_READY');
  });
});
