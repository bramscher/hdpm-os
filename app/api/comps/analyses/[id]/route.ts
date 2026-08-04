import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getRentAnalysis, updateRentAnalysis, deleteRentAnalysis } from '@/lib/rent-analyses';
import { generateRentReportPdf } from '@/lib/rent-report-pdf';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { RentAnalysis } from '@/types/comps';

/**
 * GET /api/comps/analyses/[id]
 * Get a single saved analysis (includes full analysis_json for editing)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const analysis = await getRentAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('[Analyses] Get error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get analysis';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/comps/analyses/[id]
 * Update a saved analysis (override, owner info) and optionally regenerate PDF
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { recommended_rent_override, prepared_for, owner_email, regenerate_pdf } = body as {
      recommended_rent_override?: number | null;
      prepared_for?: string | null;
      owner_email?: string | null;
      regenerate_pdf?: boolean;
    };

    // Get existing record
    const existing = await getRentAnalysis(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Update the analysis JSON with new override/prepared_for
    const analysisJson: RentAnalysis = { ...existing.analysis_json };
    if (recommended_rent_override !== undefined) {
      analysisJson.recommended_rent_override = recommended_rent_override ?? undefined;
    }
    if (prepared_for !== undefined) {
      analysisJson.prepared_for = prepared_for ?? undefined;
    }

    const updates: Record<string, unknown> = {
      analysis_json: analysisJson,
    };
    if (recommended_rent_override !== undefined) updates.recommended_rent_override = recommended_rent_override;
    if (prepared_for !== undefined) updates.prepared_for = prepared_for;
    if (owner_email !== undefined) updates.owner_email = owner_email;

    let pdfBase64: string | null = null;

    // Regenerate PDF if requested
    if (regenerate_pdf) {
      const pdfBuffer = generateRentReportPdf(analysisJson);
      pdfBase64 = pdfBuffer.toString('base64');

      // Upload to storage
      const supabase = getSupabaseAdmin();
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const dateStr = now.toISOString().split('T')[0];
      const sanitizedAddress = existing.address.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
      const fileName = `reports/${year}/${month}/rent-analysis_${existing.town}_${sanitizedAddress}_${dateStr}.pdf`;

      await supabase.storage.from('rent-reports').upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

      updates.pdf_file_path = fileName;
    }

    const updated = await updateRentAnalysis(id, updates);

    return NextResponse.json({ analysis: updated, pdf_base64: pdfBase64 });
  } catch (error) {
    console.error('[Analyses] Update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update analysis';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/comps/analyses/[id]
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    await deleteRentAnalysis(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Analyses] Delete error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete analysis';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
