import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { addMessage, SourceInfo, AttachmentInfo } from '@/lib/supabase';

// POST - Add a message to a conversation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email;

    if (!userEmail?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id: conversationId } = await params;
    const body = await request.json();
    const { role, content, sources, attachment } = body;

    if (!role || !content) {
      return NextResponse.json(
        { error: 'Role and content are required' },
        { status: 400 }
      );
    }

    if (role !== 'user' && role !== 'assistant') {
      return NextResponse.json(
        { error: 'Role must be "user" or "assistant"' },
        { status: 400 }
      );
    }

    const senderName = role === 'user' ? (session?.user?.name || undefined) : 'AI Assistant';
    const senderEmail = role === 'user' ? (userEmail || undefined) : undefined;

    const message = await addMessage(
      conversationId,
      role,
      content,
      sources as SourceInfo[] | undefined,
      attachment as AttachmentInfo | undefined,
      senderName,
      senderEmail
    );

    return NextResponse.json({ message });
  } catch (error) {
    console.error('Error adding message:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to add message: ${errorMessage}` },
      { status: 500 }
    );
  }
}
