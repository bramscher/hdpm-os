import { describe, it, expect } from 'vitest';
import { buildActivityLine } from '@/lib/agents/dez/activity';

describe('buildActivityLine', () => {
  it('formats a DM question with actor + scope', () => {
    const line = buildActivityLine({
      kind: 'question',
      surface: 'dm',
      scope: 'general',
      actorPerson: 'Cheryl',
      summary: '"what is the deposit timeline?"',
    });
    expect(line).toBe('🔎 Cheryl · general · "what is the deposit timeline?"');
  });

  it('formats a channel question with the lane that handled it', () => {
    const line = buildActivityLine({
      kind: 'question',
      surface: 'channel',
      scope: 'maintenance',
      actorPerson: 'Brody',
      summary: '"inspection cadence?"',
    });
    expect(line).toBe('🔎 Brody · maintenance · "inspection cadence?"');
  });

  it('formats a routine run with no actor or scope', () => {
    const line = buildActivityLine({
      kind: 'routine',
      surface: 'cron',
      summary: 'ors-watch · probed 166, found 0',
    });
    expect(line).toBe('🛠 ors-watch · probed 166, found 0');
  });

  it('uses distinct icons per kind', () => {
    expect(buildActivityLine({ kind: 'subagent', summary: 'x' })).toMatch(/^🔧 /);
    expect(buildActivityLine({ kind: 'verb', summary: 'x' })).toMatch(/^⚡ /);
  });
});
