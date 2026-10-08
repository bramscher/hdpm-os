import { describe, it, expect } from 'vitest';
import { toHtml } from '@/components/eos/MarkdownLite';

describe('MarkdownLite toHtml', () => {
  it('cannot be broken out of an href (attribute injection)', () => {
    const html = toHtml('[x](https://a"onmouseover="alert(1))');
    expect(html).not.toMatch(/onmouseover="/);
    expect(html).not.toContain('<a');
  });

  it('never links javascript: or data: URLs', () => {
    expect(toHtml('[x](javascript:alert(1))')).not.toContain('<a');
    expect(toHtml('[x](data:text/html,hi)')).not.toContain('<a');
  });

  it('escapes raw HTML and quotes', () => {
    const html = toHtml(`<img src=x onerror=alert(1)> "q" 'q'`);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&quot;q&quot;');
  });

  it('still links normal app and https URLs, including query strings', () => {
    expect(toHtml('[Board](/maintenance/board)')).toContain('href="/maintenance/board"');
    expect(toHtml('[AF](https://x.appfolio.com/p?a=1&b=2)')).toContain('href="https://x.appfolio.com/p?a=1&amp;b=2"');
  });
});
