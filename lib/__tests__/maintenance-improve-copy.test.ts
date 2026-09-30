import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ create: vi.fn(), session: vi.fn(), estimate: vi.fn(), invoice: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mocks.create }; } }));
vi.mock('@/lib/require-role', () => ({ requireCompanySession: mocks.session }));
vi.mock('@/lib/require-estimate-author', () => ({ requireEstimateAuthor: mocks.estimate }));
vi.mock('@/lib/require-invoice-author', () => ({ requireInvoiceAuthor: mocks.invoice }));
import { POST } from '@/app/api/maintenance/improve-copy/route';
const request = (body: unknown) => new NextRequest('https://hdpmchat.highdesertpm.com/api/maintenance/improve-copy', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  mocks.session.mockResolvedValue({ ok: true, email: 'tech@highdesertpm.com', role: 'staff' });
  mocks.estimate.mockResolvedValue({ ok: true }); mocks.invoice.mockResolvedValue({ ok: true });
  mocks.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Replace 2 GFCI outlets.' }] });
});
afterEach(() => vi.unstubAllEnvs());
describe('maintenance copy suggestions', () => {
  it('denies unsigned callers without contacting AI', async () => {
    mocks.session.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 401 }) });
    expect((await POST(request({ description: 'test' }))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(['estimate', 'invoice'])('enforces %s author permissions', async context => {
    mocks[context as 'estimate' | 'invoice'].mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });
    expect((await POST(request({ context, description: 'test' }))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([null, {}, { description: 123 }, { description: ' ' }, { description: 'a'.repeat(6001) }, { description: 'test', context: 'other' }])('rejects invalid input %j', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('returns reviewable copy and supplies scope-preserving instructions', async () => {
    const result = await POST(request({ description: 'REPLACE 2 gfci OUTLETS', context: 'estimate' }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ rewritten: 'Replace 2 GFCI outlets.' });
    expect(mocks.create.mock.calls[0][0].system).toContain('negation');
    expect(mocks.create.mock.calls[0][0].messages[0].content).toContain('estimate');
  });
  it('supports work-order notes under the existing staff guard', async () => {
    expect((await POST(request({ description: 'replace 2 gfci outlets', context: 'work-order' }))).status).toBe(200);
    expect(mocks.invoice).not.toHaveBeenCalled(); expect(mocks.estimate).not.toHaveBeenCalled();
  });
  it('rejects changed quantities', async () => {
    expect((await POST(request({ description: 'Replace 3 GFCI outlets.' }))).status).toBe(502);
  });
  it('rejects truncated suggestions', async () => {
    mocks.create.mockResolvedValue({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Replace 2' }] });
    expect((await POST(request({ description: 'Replace 2 GFCI outlets.' }))).status).toBe(502);
  });
  it('returns a safe configuration error', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', ''); vi.stubEnv('CLAUDE_API_KEY', '');
    expect((await POST(request({ description: 'test' }))).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('does not expose provider error details', async () => {
    mocks.create.mockRejectedValue(new Error('private provider details'));
    const result = await POST(request({ description: 'test' }));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('private provider details');
  });
});
