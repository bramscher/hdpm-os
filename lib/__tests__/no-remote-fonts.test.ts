import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

/**
 * next/font/google downloads font files during `next build`; when Google
 * Fonts hiccups, the production deploy fails. Fonts are self-hosted with
 * next/font/local instead (see app/partners/(referrer)/layout.tsx).
 */
describe('fonts are self-hosted', () => {
  it('nothing imports next/font/google', () => {
    const root = path.resolve(__dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|jsx?|mjs|cjs|css)$/.test(name) && !full.endsWith('no-remote-fonts.test.ts')) {
          const src = readFileSync(full, 'utf8');
          // Any import/require form of (@)next/font/google, or a CSS @import from Google Fonts.
          if (/['"](@next|next)\/font\/google['"]/.test(src) || /fonts\.(googleapis|gstatic)\.com/.test(src)) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    for (const dir of ['app', 'components', 'lib', 'styles']) {
      if (existsSync(path.join(root, dir))) walk(path.join(root, dir));
    }
    expect(offenders).toEqual([]);
  });
});
