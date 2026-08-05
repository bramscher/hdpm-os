import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { askRAG } from '@/lib/rag';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { message } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required and must be a string' },
        { status: 400 }
      );
    }

    // Trim and validate message length
    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) {
      return NextResponse.json(
        { error: 'Message cannot be empty' },
        { status: 400 }
      );
    }

    if (trimmedMessage.length > 2000) {
      return NextResponse.json(
        { error: 'Message is too long (max 2000 characters)' },
        { status: 400 }
      );
    }

    // Call RAG function
    const response = await askRAG(trimmedMessage);

    return NextResponse.json({
      answer: response.answer,
      sources: response.sources,
    });
  } catch (error) {
    console.error('Chat API error:', error);

    // Return appropriate error message
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
