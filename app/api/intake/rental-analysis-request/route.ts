import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyServiceToken, bearerFromHeader } from '@/lib/service-tokens';

interface SubjectIn {
  address: string;
  town: string;
  zip_code?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  property_type?: string;
  amenities?: string[];
  current_rent?: number;
}

interface ContactIn {
  first_name: string;
  last_name?: string;
  email: string;
  phone?: string;
}

interface Body {
  source_app?: string;
  lead_id?: number;
  contact: ContactIn;
  subject: SubjectIn;
  message?: string;
}

/**
 * POST /api/intake/rental-analysis-request
 *
 * Service-to-service intake from hdpm-web. Creates a draft row in
 * rent_analyses with status='requested' so it shows up in the comps
 * dashboard for an operator to run the analysis, review, and deliver.
 *
 * Auth: Bearer token with 'intake' scope (service_token table; legacy
 * HDPM_SERVICE_TOKEN accepted as fallback — lib/service-tokens.ts).
 */
export async function POST(req: NextRequest) {
  const identity = await verifyServiceToken(
    bearerFromHeader(req.headers.get('authorization')),
    'intake'
  );
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body?.subject?.address || !body?.subject?.town) {
    return NextResponse.json(
      { error: 'subject.address and subject.town are required' },
      { status: 400 }
    );
  }
  if (!body?.contact?.email || !body?.contact?.first_name) {
    return NextResponse.json(
      { error: 'contact.first_name and contact.email are required' },
      { status: 400 }
    );
  }

  const subject = body.subject;
  const contact = body.contact;
  const preparedFor = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();

  const placeholderRent = subject.current_rent ?? 0;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('rent_analyses')
      .insert({
        address: subject.address,
        town: subject.town,
        bedrooms: subject.bedrooms ?? 0,
        bathrooms: subject.bathrooms ?? null,
        sqft: subject.sqft ?? null,
        property_type: subject.property_type ?? 'SFR',
        // Placeholder rent values; the analysis hasn't been generated yet.
        recommended_rent_low: placeholderRent,
        recommended_rent_mid: placeholderRent,
        recommended_rent_high: placeholderRent,
        prepared_for: preparedFor || null,
        owner_email: contact.email,
        owner_phone: contact.phone ?? null,
        requester_message: body.message ?? null,
        // Empty payload; the existing analysis_json column is NOT NULL.
        analysis_json: {
          status: 'requested',
          subject: {
            address: subject.address,
            town: subject.town,
            zip_code: subject.zip_code,
            bedrooms: subject.bedrooms,
            bathrooms: subject.bathrooms,
            sqft: subject.sqft,
            property_type: subject.property_type,
            amenities: subject.amenities ?? [],
            current_rent: subject.current_rent,
          },
          contact: {
            first_name: contact.first_name,
            last_name: contact.last_name,
            email: contact.email,
            phone: contact.phone,
          },
          message: body.message ?? null,
        },
        status: 'requested',
        source: 'owner_intake',
        source_app: body.source_app ?? 'hdpm-web',
        requested_by_lead_id: body.lead_id ?? null,
        requested_at: new Date().toISOString(),
        created_by: 'hdpm-web@system',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[intake/rental-analysis-request] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create analysis request' },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: data?.id, status: 'requested' });
  } catch (err) {
    console.error('[intake/rental-analysis-request] exception:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Intake failed' },
      { status: 500 }
    );
  }
}
