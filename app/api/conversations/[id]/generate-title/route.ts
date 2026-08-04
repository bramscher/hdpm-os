import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import { updateConversationTitle } from '@/lib/supabase';

function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable is not set');
  }
  return new Anthropic({ apiKey });
}

// POST - Generate and update conversation title based on first message
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
    const { firstMessage, hasAttachment, attachmentName } = body;

    if (!firstMessage) {
      return NextResponse.json(
        { error: 'First message is required' },
        { status: 400 }
      );
    }

    // Generate title using Claude Haiku (fast and cheap)
    const anthropic = getAnthropic();

    let prompt = `Generate a short, descriptive title (5-8 words max) for a conversation that starts with this message:

"${firstMessage.substring(0, 500)}"`;

    if (hasAttachment && attachmentName) {
      prompt += `\n\nThe user also attached a document: "${attachmentName}"`;
    }

    prompt += `

Rules:
- Title should capture the main topic or question
- Keep it concise (5-8 words maximum)
- Use sentence case (capitalize first word only)
- Don't use quotes or punctuation at the end
- Focus on the legal/property management topic if applicable

Respond with ONLY the title, nothing else.`;

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    let title = 'New Conversation';
    if (response.content[0].type === 'text') {
      title = response.content[0].text.trim();
      // Clean up any quotes or extra punctuation
      title = title.replace(/^["']|["']$/g, '').trim();
      // Limit length
      if (title.length > 60) {
        title = title.substring(0, 57) + '...';
      }
    }

    // Update the conversation title in the database
    await updateConversationTitle(conversationId, title);

    return NextResponse.json({ title });
  } catch (error) {
    console.error('Error generating title:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to generate title: ${errorMessage}` },
      { status: 500 }
    );
  }
}
