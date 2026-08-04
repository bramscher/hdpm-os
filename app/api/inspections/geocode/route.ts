import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { batchGeocodeProperties } from '@/lib/inspection-geocode';

/**
 * POST /api/inspections/geocode
 *
 * Batch geocode inspection properties with pending/failed geocode_status.
 * Streams progress via SSE.
 *
 * Optional body: { property_ids?: string[] } to geocode specific properties.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let propertyIds: string[] | undefined;
    try {
      const body = await request.json();
      propertyIds = body.property_ids;
    } catch {
      // No body — geocode all pending
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const result = await batchGeocodeProperties(propertyIds, (completed, total, geocodeResult) => {
            send({
              type: 'progress',
              completed,
              total,
              address: geocodeResult.address,
              success: geocodeResult.success,
              error: geocodeResult.error,
            });
          });

          send({
            type: 'complete',
            ...result,
          });
        } catch (err) {
          send({
            type: 'error',
            message: err instanceof Error ? err.message : 'Geocoding failed',
          });
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Geocode error:', error);
    const message = error instanceof Error ? error.message : 'Geocoding failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
