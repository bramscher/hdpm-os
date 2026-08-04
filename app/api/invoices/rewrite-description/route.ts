import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable is not set');
  }
  return new Anthropic({ apiKey });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { description } = await request.json();
    if (!description?.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Rewrite this maintenance work description for a professional property maintenance invoice. Keep it concise, clear, and professional. Use proper maintenance/trade terminology. Do not add any preamble, explanation, or quotes — return ONLY the rewritten description text.

Original: ${description.trim()}`,
        },
      ],
    });

    const rewritten =
      response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    return NextResponse.json({ rewritten });
  } catch (error) {
    console.error('Rewrite description error:', error);
    const message = error instanceof Error ? error.message : 'Failed to rewrite description';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
