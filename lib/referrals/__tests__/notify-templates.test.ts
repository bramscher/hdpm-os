import { describe, it, expect } from 'vitest';
import {
  buildAccrualEmail,
  buildPayoutEmail,
  shouldNotifyStatusChange,
  stageLabel,
  buildLeadSubmittedEmail,
  buildStatusChangeEmail,
  buildW9MissingEmail,
  buildInviteEmail,
} from '../notify-templates';

describe('shouldNotifyStatusChange', () => {
  it('notifies on a real transition', () => {
    expect(shouldNotifyStatusChange('submitted', 'contacted')).toBe(true);
  });
  it('skips a no-op', () => {
    expect(shouldNotifyStatusChange('contacted', 'contacted')).toBe(false);
  });
  it('notifies on first change from null', () => {
    expect(shouldNotifyStatusChange(null, 'submitted')).toBe(true);
  });
});

describe('stageLabel', () => {
  it('gives friendly labels', () => {
    expect(stageLabel('agreement_signed')).toBe('Agreement signed');
    expect(stageLabel('active')).toContain('under management');
  });
});

describe('email templates', () => {
  it('lead submitted names the prospect and source', () => {
    const e = buildLeadSubmittedEmail({ prospect_name: 'Jane Owner', source: 'referral', partner_name: 'Bob Agent' });
    expect(e.subject).toContain('Jane Owner');
    expect(e.html).toContain('Bob Agent');
    expect(e.text).toContain('referral');
  });

  it('status change uses the friendly label', () => {
    const e = buildStatusChangeEmail({ prospect_name: 'Jane Owner', to: 'agreement_signed' });
    expect(e.subject).toContain('Agreement signed');
    expect(e.html).toContain('Jane Owner');
  });

  it('invite email carries the link (button + plaintext fallback)', () => {
    const e = buildInviteEmail({ partner_name: 'Bob Agent', url: 'https://x.test/partners/invite/abc' });
    expect(e.subject.toLowerCase()).toContain('invited');
    expect(e.html).toContain('https://x.test/partners/invite/abc');
    expect(e.text).toContain('https://x.test/partners/invite/abc');
  });

  it('w9 missing addresses the partner', () => {
    const e = buildW9MissingEmail({ partner_name: 'Bob Agent' });
    expect(e.html).toContain('Bob Agent');
    expect(e.subject.toLowerCase()).toContain('w-9');
  });
});

describe('bounty emails (Batch 5)', () => {
  it('accrual names the amount and escapes the prospect name', () => {
    const e = buildAccrualEmail({ prospect_name: 'Ann <b>Owner</b>', amount: 500 });
    expect(e.subject).toBe('You earned a $500.00 referral bounty');
    expect(e.html).toContain('Ann &lt;b&gt;Owner&lt;/b&gt;');
    expect(e.html).not.toContain('<b>Owner</b>');
    expect(e.text).toContain('pending approval');
  });

  it('payout includes the reference when given', () => {
    const withRef = buildPayoutEmail({ prospect_name: 'Ann', amount: 1250.5, reference: 'CHK-1042' });
    expect(withRef.subject).toBe('Your $1,250.50 referral bounty has been paid');
    expect(withRef.html).toContain('reference CHK-1042');
    expect(buildPayoutEmail({ prospect_name: 'Ann', amount: 10, reference: null }).text).not.toContain('reference');
  });
});

describe('escaping in the original referral emails', () => {
  const evil = 'Ann <img src=x onerror=alert(1)> "O\'Neil"';

  it('lead submitted escapes the prospect and partner names', () => {
    const e = buildLeadSubmittedEmail({ prospect_name: evil, source: 'referral', partner_name: 'Bob <b>' });
    expect(e.html).not.toContain('<img');
    expect(e.html).toContain('Ann &lt;img src=x onerror=alert(1)&gt; &quot;O&#39;Neil&quot;');
    expect(e.html).toContain('Bob &lt;b&gt; (referral)');
  });

  it('status change escapes the prospect name and keeps subjects on one line', () => {
    const e = buildStatusChangeEmail({ prospect_name: 'Ann\r\nBcc: x@y.com', to: 'qualified' });
    expect(e.subject).toBe('Your referral Ann Bcc: x@y.com is now: Qualified');
    expect(e.subject).not.toMatch(/[\r\n]/);
    expect(buildStatusChangeEmail({ prospect_name: evil, to: 'qualified' }).html).not.toContain('<img');
  });

  it('invite escapes the name and the link', () => {
    const e = buildInviteEmail({ partner_name: '<script>x</script>', url: 'https://os.example/partners/invite/abc"><script>' });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('href="https://os.example/partners/invite/abc&quot;&gt;&lt;script&gt;"');
    expect(e.text).toContain('<script>x</script>'); // plain-text part is not HTML
  });

  it('W-9 reminder escapes the name', () => {
    expect(buildW9MissingEmail({ partner_name: '<b>Pat</b>' }).html).toContain('Hi &lt;b&gt;Pat&lt;/b&gt;');
  });
});
