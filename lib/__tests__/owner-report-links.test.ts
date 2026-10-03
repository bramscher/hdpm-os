import { describe, it, expect } from 'vitest';
import { PUBLIC_PREFIXES } from '@/proxy';
import { rentReportFileName } from '../rent-report-files';

const isPublic = (p: string) => PUBLIC_PREFIXES.some((x) => p.startsWith(x));

describe('owner report links', () => {
  it('opens rent analysis short links without a staff session', () => {
    expect(isPublic('/r/RnMM_Pui')).toBe(true);
  });

  it('does not open other pages that merely start with "r"', () => {
    for (const p of ['/r', '/reports', '/reports/owner', '/routes', '/rent', '/comps/analysis', '/receptions']) {
      expect(isPublic(p), p).toBe(false);
    }
  });
});

describe('rent report file names', () => {
  const at = new Date('2026-10-03T22:07:52.123Z');

  it('gives every generation its own file so same-day reruns never overwrite a sent report', () => {
    const a = rentReportFileName('Redmond', '2987 SW Deschutes Ave, Redmond, OR 97756, USA', at, 'ab12');
    expect(a).toBe('reports/2026/10/rent-analysis_Redmond_2987_SW_Deschutes_Ave__Redmond__OR_97756_20261003T220752Z_ab12.pdf');
    const b = rentReportFileName('Redmond', '2987 SW Deschutes Ave, Redmond, OR 97756, USA', new Date(at.getTime() + 60_000));
    expect(b).not.toBe(a);
  });

  it('keeps town names with spaces path-safe', () => {
    expect(rentReportFileName('La Pine', '1 Main St', at, 'x')).toContain('rent-analysis_La_Pine_1_Main_St_');
  });
});
