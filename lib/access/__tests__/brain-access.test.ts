import { describe, it, expect } from 'vitest';
import { PUBLIC_PREFIXES } from '@/proxy';
import { checkPath } from '../sections';

const isPublic = (p: string) => PUBLIC_PREFIXES.some((x) => p.startsWith(x));

describe('brain map access', () => {
  it('keeps machine-called brain routes public (they guard themselves)', () => {
    for (const p of ['/api/brain/cron/snapshot', '/api/brain/cron/evolve', '/api/brain/search', '/api/brain/think']) {
      expect(isPublic(p), p).toBe(true);
    }
  });

  it('sends the UI-only viz routes through the session + section gate', () => {
    expect(isPublic('/api/brain/viz')).toBe(false);
    expect(isPublic('/api/brain/viz/ask')).toBe(false);
  });

  it('denies the viz routes to someone with the brain section switched off', () => {
    expect(checkPath('/api/brain/viz', ['brain']).allowed).toBe(false);
    expect(checkPath('/api/brain/viz/ask', ['brain']).allowed).toBe(false);
    expect(checkPath('/brain', ['brain']).allowed).toBe(false);
    expect(checkPath('/api/brain/viz', []).allowed).toBe(true);
    expect(checkPath('/api/brain/viz', ['agents']).allowed).toBe(true);
  });
});
