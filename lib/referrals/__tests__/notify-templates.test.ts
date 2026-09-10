import { describe, it, expect } from 'vitest';
import {
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
