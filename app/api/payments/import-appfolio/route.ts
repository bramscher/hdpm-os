import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { importAppfolioPayments } from '@/lib/af-payment-import';
import { reportsApiConfigured } from '@/lib/appfolio-reports';

export const maxDuration = 120;

// Import HDMS trust-account disbursements from the AppFolio check register and
// attach the invoices their bills covered (see lib/af-payment-import.ts).
export async function POST() {
  try {
    const session = await getServerSession();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }
    if (!reportsApiConfigured()) {
      return NextResponse.json(
        { error: 'AppFolio Reports API credentials not configured.' },
        { status: 503 }
      );
    }

    const result = await importAppfolioPayments(session.user.email);
    return NextResponse.json({ result });
  } catch (error) {
    console.error('AppFolio payment import error:', error);
    const message = error instanceof Error ? error.message : 'Import failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
