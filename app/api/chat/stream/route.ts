import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { askRAGStream } from '@/lib/rag';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized. Please sign in with your company Microsoft account.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { message, documentContent, documentName } = body;

    if (!message || typeof message !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Message is required and must be a string' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Message cannot be empty' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (trimmedMessage.length > 2000) {
      return new Response(
        JSON.stringify({ error: 'Message is too long (max 2000 characters)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get streaming response with optional document context
    const { stream, sources } = await askRAGStream(
      trimmedMessage,
      documentContent,
      documentName
    );

    // Create a readable stream that sends sources first, then text chunks
    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        // Send sources first as a JSON line
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`));

        // Stream the text chunks
        for await (const chunk of stream) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`));
        }

        // Send done signal
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
        controller.close();
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat stream API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
