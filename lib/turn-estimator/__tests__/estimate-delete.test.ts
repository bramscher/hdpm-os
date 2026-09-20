import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/require-role', () => ({ requireRole: mocks.guard }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ rpc: mocks.rpc }) }));
import { DELETE } from '@/app/api/turn-estimator/estimate-queue/route';
const id = '00000000-0000-4000-8000-000000000001';
const invoke = (query = `id=${id}&kind=saved`) => DELETE(new NextRequest(`https://example.test/api/turn-estimator/estimate-queue?${query}`, { method: 'DELETE' }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, email: 'office@example.test' });
  mocks.rpc.mockResolvedValue({ error: null });
});
describe('delete draft estimate', () => {
  it('requires an editing role before accessing the database', async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await invoke()).status).toBe(403);
    expect(mocks.guard).toHaveBeenCalledWith('maintenance', 'pm', 'manager');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects invalid identifiers and draft kinds', async () => {
    for (const query of ['id=bad&kind=saved', `id=${id}&kind=other`, '']) expect((await invoke(query)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['saved', 'header'])('deletes a %s draft through the atomic database function', async kind => {
    expect(await (await invoke(`id=${id}&kind=${kind}`)).json()).toEqual({ deleted: true });
    expect(mocks.rpc).toHaveBeenCalledWith('maintenance_delete_estimate_draft', { actor: 'office@example.test', request: { id, kind } });
  });
  it('reports conflicts without claiming success', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'Only unissued draft estimates can be deleted' } });
    const response = await invoke();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Only unissued');
  });
});
