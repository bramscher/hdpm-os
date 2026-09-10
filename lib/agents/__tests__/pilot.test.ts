import { describe, it, expect, afterEach } from 'vitest';
import { getPilotConfig, isPilotActive } from '../pilot';

const ORIG = { ...process.env };

afterEach(() => {
  process.env = { ...ORIG };
});

describe('getPilotConfig', () => {
  it('is off with no env — no recipients, not shadow', () => {
    delete process.env.AGENT_PILOT_RECIPIENTS;
    delete process.env.AGENT_PILOT_SHADOW;
    const cfg = getPilotConfig();
    expect(cfg.recipients).toEqual([]);
    expect(cfg.shadow).toBe(false);
    expect(isPilotActive(cfg)).toBe(false);
  });

  it('parses a comma-separated recipient list, trimming blanks', () => {
    process.env.AGENT_PILOT_RECIPIENTS = ' Craig , Brody ,, ';
    const cfg = getPilotConfig();
    expect(cfg.recipients).toEqual(['Craig', 'Brody']);
    expect(isPilotActive(cfg)).toBe(true);
  });

  it('treats an all-blank list as inactive', () => {
    process.env.AGENT_PILOT_RECIPIENTS = ' , , ';
    expect(isPilotActive(getPilotConfig())).toBe(false);
  });

  it('shadow is true only for exactly "1"', () => {
    process.env.AGENT_PILOT_SHADOW = '1';
    expect(getPilotConfig().shadow).toBe(true);
    process.env.AGENT_PILOT_SHADOW = 'true';
    expect(getPilotConfig().shadow).toBe(false);
    process.env.AGENT_PILOT_SHADOW = '0';
    expect(getPilotConfig().shadow).toBe(false);
  });
});
