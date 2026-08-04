import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { syncAfBills } from '@/lib/af-bills';

// Full-backfill sync pages through ~9 requests of 1000 bills; allow time.
export const maxDuration = 300;

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const result = await syncAfBills();
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Sync AF bills error:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync AppFolio bills';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
