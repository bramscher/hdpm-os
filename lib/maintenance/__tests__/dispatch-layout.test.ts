import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_KEY, loadLayout, parseLayout, saveLayout } from '../dispatch-layout';

afterEach(() => vi.unstubAllGlobals());

describe('dispatch layout', () => {
  it('reads back what was saved', () => {
    const layout = { collapsed: ['vendor:v1', 'tech:Brody'], pinned: ['v9'], pile: 'overdue' as const, sorts: { 'tech:Alberto': 'age' as const }, weekOpen: false };
    expect(parseLayout(JSON.stringify(layout))).toEqual(layout);
  });

  it('falls back to the default for missing, broken or foreign data', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{not json')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('42')).toEqual(DEFAULT_LAYOUT);
  });

  it('drops values it does not recognise but keeps the rest', () => {
    const parsed = parseLayout(JSON.stringify({ collapsed: ['a', 'a', 3, ''], pile: 'mystery', sorts: { x: 'random', y: 'date' }, weekOpen: 'yes' }));
    expect(parsed).toEqual({ collapsed: ['a'], pinned: [], pile: 'all', sorts: { y: 'date' }, weekOpen: true });
  });

  it('still works when the browser blocks storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
    expect(() => saveLayout(DEFAULT_LAYOUT)).not.toThrow();
  });

  it('saves under one versioned key', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    saveLayout({ ...DEFAULT_LAYOUT, pinned: ['v1'] });
    expect([...store.keys()]).toEqual([LAYOUT_KEY]);
    expect(loadLayout().pinned).toEqual(['v1']);
  });
});
