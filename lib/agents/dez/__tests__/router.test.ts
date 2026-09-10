import { describe, it, expect } from 'vitest';
import { routeToScope, parseChannelMap } from '@/lib/agents/dez/router';

describe('parseChannelMap', () => {
  it('parses a valid map and drops unknown scopes', () => {
    const map = parseChannelMap('{"C1":"maintenance","C2":"leasing","C3":"bogus"}');
    expect(map).toEqual({ C1: 'maintenance', C2: 'leasing' });
  });

  it('degrades to {} on missing/malformed input', () => {
    expect(parseChannelMap(undefined)).toEqual({});
    expect(parseChannelMap('not json')).toEqual({});
    expect(parseChannelMap('[1,2,3]')).toEqual({});
  });
});

describe('routeToScope', () => {
  const map = { C0MAINT: 'maintenance', C0LEASE: 'leasing' } as const;

  it('routes DMs to general regardless of channel', () => {
    expect(routeToScope('C0MAINT', 'im', map).scope).toBe('general');
    expect(routeToScope(undefined, 'im', map).scope).toBe('general');
  });

  it('routes a mapped channel to its scope with a label', () => {
    const r = routeToScope('C0MAINT', 'channel', map);
    expect(r.scope).toBe('maintenance');
    expect(r.label).toBe('maintenance');
    expect(routeToScope('C0LEASE', 'channel', map).label).toBe('leasing / front desk');
  });

  it('falls back to general for an unmapped channel', () => {
    expect(routeToScope('C_UNKNOWN', 'channel', map).scope).toBe('general');
  });
});
