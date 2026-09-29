import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { extractWorkOrderItems } from '@/lib/work-order-extraction';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
    return NextResponse.json({ error: 'Unauthorized. Please sign in with your company Microsoft account.' }, { status: 401 });
  }
  try {
    const { description } = await request.json();
    if (typeof description !== 'string') return NextResponse.json({ error: 'Description must be text' }, { status: 400 });
    return NextResponse.json(await extractWorkOrderItems(description));
  } catch (error) {
    console.error('[extract-materials] Extraction failed:', error);
    return NextResponse.json({ error: 'Could not separate labor and materials. Your original work-order description is preserved.' }, { status: 500 });
  }
}
