import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAfBills } from '@/lib/af-bills';

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { bills, summary } = await getAfBills();
    return NextResponse.json({ bills, summary });
  } catch (error) {
    console.error('Get AF bills error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch AppFolio bills';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
