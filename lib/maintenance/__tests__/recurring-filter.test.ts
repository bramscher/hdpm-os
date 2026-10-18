import { describe, expect, it } from 'vitest';
import { isRecurringWork } from '../recurring';
import { filterRecurring } from '../../../app/maintenance/board/board-types';
import type { MaintWorkOrder } from '../types';

const wo = (id: string, description: string, appfolio_recurring = false) => ({ id, description, appfolio_recurring }) as unknown as MaintWorkOrder;

describe('recurring work', () => {
  it('counts AppFolio recurring work orders, whatever they are', () => {
    expect(isRecurringWork({ appfolio_recurring: true, description: 'Chimney Sweep' })).toBe(true);
    expect(isRecurringWork({ appfolio_recurring: true, description: 'Back Flow Testing' })).toBe(true);
  });

  it('counts hand-typed winterizations and spring start-ups too', () => {
    for (const d of ['Irrigation / Winterization', 'Winterize the sprinklers', 'De-winterize irrigation', 'Spring start-up', 'Spring turn on irrigation', 'Irrigation start up']) {
      expect(isRecurringWork({ appfolio_recurring: false, description: d })).toBe(true);
    }
  });

  it('leaves ordinary repairs alone', () => {
    for (const d of ['Broken/leaking sprinkler', 'No heat', 'Clear gutters on duplex', 'Spring is broken on garage door']) {
      expect(isRecurringWork({ appfolio_recurring: false, description: d })).toBe(false);
    }
    expect(isRecurringWork({ appfolio_recurring: null, description: null })).toBe(false);
  });

  it('filters the board: all, hide recurring, only recurring', () => {
    const list = [wo('a', 'Irrigation Winterization', true), wo('b', 'Leaky faucet'), wo('c', 'Irrigation / winterization')];
    expect(filterRecurring(list, 'all').map((w) => w.id)).toEqual(['a', 'b', 'c']);
    expect(filterRecurring(list, 'hide').map((w) => w.id)).toEqual(['b']);
    expect(filterRecurring(list, 'only').map((w) => w.id)).toEqual(['a', 'c']);
  });
});
