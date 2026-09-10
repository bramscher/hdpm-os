import { describe, it, expect } from 'vitest';
import { buildOrsDigestActionId, parseOrsDigestActionId } from '@/lib/agents/ors-digest';

describe('ors digest action id', () => {
  it('round-trips a section number', () => {
    expect(parseOrsDigestActionId(buildOrsDigestActionId('90.427'))).toEqual({ section: '90.427' });
  });

  it('returns null for other namespaces', () => {
    expect(parseOrsDigestActionId('op:approve:p1')).toBeNull();
    expect(parseOrsDigestActionId('ec:sendsms:x')).toBeNull();
    expect(parseOrsDigestActionId('ors:digest:')).toBeNull(); // empty section
  });
});
