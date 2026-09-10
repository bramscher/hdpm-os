import { describe, it, expect } from 'vitest';
import {
  canTransition,
  allowedNext,
  deriveLegacyStatus,
  isExceptionState,
  isTerminalState,
  TURN_STATES,
} from '@/lib/turn-estimator/turn-lifecycle';

describe('linear chain', () => {
  it('permits each state to advance to the next', () => {
    for (let i = 0; i < TURN_STATES.length - 1; i++) {
      expect(canTransition(TURN_STATES[i], TURN_STATES[i + 1])).toBe(true);
    }
  });
  it('forbids skipping ahead (except the two explicit edges)', () => {
    expect(canTransition('NOTICE_RECEIVED', 'APPROVED')).toBe(false);
    expect(canTransition('SCOPE_DRAFT', 'INVOICE_REVIEW')).toBe(false);
  });
  it('forbids self-transition', () => {
    expect(canTransition('IN_PROGRESS', 'IN_PROGRESS')).toBe(false);
  });
});

describe('explicit edges', () => {
  it('auto-approval skips APPROVAL_PENDING', () => {
    expect(canTransition('ESTIMATE_READY', 'APPROVED')).toBe(true);
  });
  it('changes-requested returns to SCOPE_DRAFT', () => {
    expect(canTransition('APPROVAL_PENDING', 'SCOPE_DRAFT')).toBe(true);
  });
});

describe('exceptions', () => {
  it('can enter an exception from a main state, not from another exception', () => {
    expect(canTransition('IN_PROGRESS', 'ON_HOLD_PARTS')).toBe(true);
    expect(canTransition('ON_HOLD_PARTS', 'ON_HOLD_VENDOR')).toBe(false);
  });
  it('resumes from an exception to any main state', () => {
    expect(canTransition('ON_HOLD_VENDOR', 'SCHEDULED')).toBe(true);
    expect(canTransition('CHANGE_ORDER_PENDING', 'APPROVAL_PENDING')).toBe(true);
  });
  it('CANCELLED is reachable from any non-terminal state', () => {
    expect(canTransition('NOTICE_RECEIVED', 'CANCELLED')).toBe(true);
    expect(canTransition('TURN_READY', 'CANCELLED')).toBe(true);
  });
});

describe('terminal states', () => {
  it('nothing leaves CLOSED or CANCELLED', () => {
    expect(isTerminalState('CLOSED')).toBe(true);
    expect(isTerminalState('CANCELLED')).toBe(true);
    expect(allowedNext('CLOSED')).toHaveLength(0);
    expect(allowedNext('CANCELLED')).toHaveLength(0);
    expect(canTransition('CLOSED', 'POSTED')).toBe(false);
  });
});

describe('deriveLegacyStatus', () => {
  it('maps the lifecycle to active/ready/closed for the existing board', () => {
    expect(deriveLegacyStatus('NOTICE_RECEIVED')).toBe('active');
    expect(deriveLegacyStatus('IN_PROGRESS')).toBe('active');
    expect(deriveLegacyStatus('ON_HOLD_OWNER')).toBe('active');
    expect(deriveLegacyStatus('TURN_READY')).toBe('ready');
    expect(deriveLegacyStatus('INVOICED')).toBe('ready');
    expect(deriveLegacyStatus('POSTED')).toBe('ready');
    expect(deriveLegacyStatus('CLOSED')).toBe('closed');
    expect(deriveLegacyStatus('CANCELLED')).toBe('closed');
  });
});

describe('helpers', () => {
  it('classifies exception states', () => {
    expect(isExceptionState('DISPUTED')).toBe(true);
    expect(isExceptionState('IN_PROGRESS')).toBe(false);
  });
  it('rejects unknown statuses', () => {
    expect(canTransition('BOGUS', 'CLOSED')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'BOGUS')).toBe(false);
  });
});
