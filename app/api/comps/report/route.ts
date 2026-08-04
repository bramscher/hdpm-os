import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { randomBytes } from 'crypto';
import { generateRentAnalysis } from '@/lib/rent-analysis';
import { generateRentReportPdf } from '@/lib/rent-report-pdf';
import { getSupabaseAdmin } from '@/lib/supabase';
import { saveRentAnalysis } from '@/lib/rent-analyses';
import type { SubjectProperty, CompetingListing } from '@/types/comps';

/** Generate a URL-safe short ID (8 chars) */
function generateShortId(): string {
  return randomBytes(6).toString('base64url').substring(0, 8);
}

/**
 * POST /api/comps/report
 *
 * Generate a rent analysis report:
 * 1. Run analysis engine on subject property
 * 2. Generate branded PDF
 * 3. Upload to Supabase Storage
 * 4. Create short link for sharing
 * 5. Return download URL + short link
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { subject, competing_listings, prepared_for, recommended_rent_override, owner_email, manager_notes } = body as {
      subject: SubjectProperty;
      competing_listings?: CompetingListing[];
      prepared_for?: string;
      recommended_rent_override?: number;
      owner_email?: string;
      manager_notes?: string;
    };

    // Validate required subject fields
    if (!subject?.address || !subject?.town || subject?.bedrooms === undefined) {
      return NextResponse.json(
        { error: 'Subject property must include address, town, and bedrooms' },
        { status: 400 }
      );
    }

    console.log(`[Report] Generating rent analysis for ${subject.address}, ${subject.town}...`);

    // 1. Generate analysis
    const analysis = await generateRentAnalysis(
      subject,
      session.user.email,
      competing_listings
    );

    console.log(`[Report] Analysis complete: recommended $${analysis.recommended_rent_low}-$${analysis.recommended_rent_high}/mo`);

    // 2. Attach prepared_for personalization if provided
    if (prepared_for) {
      analysis.prepared_for = prepared_for;
    }

    // 2b. Attach manager notes if provided
    if (manager_notes) {
      analysis.manager_notes = manager_notes;
    }

    // 2c. Apply recommended rent override if provided
    if (recommended_rent_override && recommended_rent_override > 0) {
      analysis.recommended_rent_override = recommended_rent_override;
      analysis.methodology_notes.push(
        `Manual override: Recommended rent set to $${recommended_rent_override.toLocaleString()}/mo based on current market conditions`
      );
    }

    // 3. Generate PDF
    const pdfBuffer = generateRentReportPdf(analysis);
    console.log(`[Report] PDF generated: ${pdfBuffer.length} bytes`);

    // 4. Upload to Supabase Storage
    const supabase = getSupabaseAdmin();
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const dateStr = now.toISOString().split('T')[0];
    const sanitizedAddress = subject.address
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 40);
    const fileName = `reports/${year}/${month}/rent-analysis_${subject.town}_${sanitizedAddress}_${dateStr}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('rent-reports')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('[Report] Storage upload error:', uploadError);
      // If storage fails, still return the PDF as base64 so user can download
      const base64 = pdfBuffer.toString('base64');
      return NextResponse.json({
        analysis,
        pdf_base64: base64,
        download_url: null,
        short_url: null,
        storage_error: uploadError.message,
      });
    }

    // 5. Get signed URL (24-hour expiry) for immediate download
    const { data: signedData, error: signedError } = await supabase.storage
      .from('rent-reports')
      .createSignedUrl(fileName, 60 * 60 * 24); // 24 hours

    if (signedError) {
      console.error('[Report] Signed URL error:', signedError);
    }

    const downloadUrl = signedData?.signedUrl || null;

    // 6. Create short link for sharing (expires in 30 days)
    let shortUrl: string | null = null;
    try {
      const shortId = generateShortId();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

      const { error: linkError } = await supabase
        .from('report_links')
        .insert({
          short_id: shortId,
          file_path: fileName,
          property_address: `${subject.address}, ${subject.town}`,
          expires_at: expiresAt.toISOString(),
          created_by: session.user.email,
        });

      if (!linkError) {
        // Build the short URL using the request's host
        const host = request.headers.get('host') || 'localhost:3000';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        shortUrl = `${protocol}://${host}/r/${shortId}`;
        console.log(`[Report] Short link created: ${shortUrl}`);
      } else {
        console.warn('[Report] Short link creation failed (table may not exist yet):', linkError.message);
        // Fall back to signed URL — short links are a nice-to-have
      }
    } catch (linkErr) {
      console.warn('[Report] Short link creation skipped:', linkErr);
    }

    console.log(`[Report] Report uploaded. URL: ${downloadUrl ? 'yes' : 'no'}, Short: ${shortUrl ? 'yes' : 'no'}`);

    // 7. Save analysis to database for future reprinting/editing
    let savedId: string | null = null;
    try {
      const saved = await saveRentAnalysis({
        analysis,
        recommended_rent_override: recommended_rent_override ?? null,
        prepared_for: prepared_for ?? null,
        owner_email: owner_email ?? null,
        manager_notes: manager_notes ?? null,
        pdf_file_path: fileName,
        short_url: shortUrl,
        created_by: session.user.email,
      });
      savedId = saved.id;
      console.log(`[Report] Analysis saved to DB: ${savedId}`);
    } catch (saveErr) {
      // Non-fatal — user still gets their PDF
      console.warn('[Report] Failed to save analysis to DB:', saveErr);
    }

    // Also return base64 for immediate download
    const base64 = pdfBuffer.toString('base64');

    return NextResponse.json({
      analysis,
      pdf_base64: base64,
      download_url: downloadUrl,
      short_url: shortUrl,
      saved_id: savedId,
    });
  } catch (error) {
    console.error('[Report] Error:', error);
    const message = error instanceof Error ? error.message : 'Report generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
