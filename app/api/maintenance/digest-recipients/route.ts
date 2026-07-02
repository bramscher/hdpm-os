import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { requireAdmin } from '@/lib/require-admin';
import { listDigestRecipients, saveDigestRecipient } from '@/lib/maintenance/recipients';

/** GET /api/maintenance/digest-recipients — roster + opt-in state (any staff). */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const recipients = await listDigestRecipients();
  return NextResponse.json({ recipients });
}

/**
 * PUT /api/maintenance/digest-recipients — admin-only opt-in editor.
 * Body: { person, email, enabled }
 */
export async function PUT(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    if (!body.person) {
      return NextResponse.json({ error: 'person is required' }, { status: 400 });
    }
    const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
    if (body.enabled && !email) {
      return NextResponse.json(
        { error: 'An email is required to enable digests for a person' },
        { status: 400 }
      );
    }
    const recipient = await saveDigestRecipient(body.person, email, !!body.enabled);
    return NextResponse.json({ recipient });
  } catch (error) {
    console.error('[Maintenance] Recipient save error:', error);
    const message = error instanceof Error ? error.message : 'Failed to save recipient';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
