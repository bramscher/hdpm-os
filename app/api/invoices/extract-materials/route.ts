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
      console.log('[extract-materials] Unauthorized request');
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { description } = await request.json();
    console.log(`[extract-materials] Input (${description?.length || 0} chars): ${description?.substring(0, 200)}`);

    if (!description?.trim()) {
      return NextResponse.json({ materials: [], laborDescription: '' });
    }

    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `You are parsing a property maintenance work order description for an invoice system. Separate each line/item into LABOR or MATERIALS.

CRITICAL: Preserve the FULL original text of each line. Do NOT shorten, summarize, or reduce descriptions. Copy them exactly as written.

CLASSIFICATION RULES:
- Lines that are product names, model numbers, part descriptions, appliances, fixtures, supplies → MATERIALS
  Examples: "GE 30-in 4 Burners 5.0 cu ft Freestanding Electric Range White" → material with FULL description
  "6 FT 50 Amp Range Cord" → material with FULL description
  "Moen Adler single handle faucet" → material with FULL description
- Lines that are service/task descriptions → LABOR
  Examples: "Haul Away" → labor, "Install and hook up range" → labor, "Replace kitchen faucet and supply lines" → labor
- If a line contains BOTH a task AND a specific product/part, keep the FULL line as a material.
  Example: "Replace toilet flapper - Korky 2\" universal" → material: "Toilet flapper - Korky 2\" universal"
- If a line is purely a task with no specific part named → LABOR
  Example: "Diagnose leak under sink" → labor

Return a JSON object:
{
  "materials": [
    { "description": "FULL original text of the material line", "amount": "cost if mentioned, otherwise 0" }
  ],
  "laborDescription": "ALL labor lines combined with newlines between them, preserving full text. Empty string if no labor lines."
}

Return ONLY valid JSON, no other text.

Work Order Description:
${description.trim()}`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      console.log('[extract-materials] Non-text response from AI');
      return NextResponse.json({ materials: [], laborDescription: '' });
    }

    console.log(`[extract-materials] AI response: ${content.text.substring(0, 500)}`);

    let jsonStr = content.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      const materials = Array.isArray(parsed.materials) ? parsed.materials : [];
      const laborDescription = typeof parsed.laborDescription === 'string' ? parsed.laborDescription : '';
      console.log(`[extract-materials] Found ${materials.length} materials, labor: "${laborDescription.substring(0, 100)}"`);
      return NextResponse.json({ materials, laborDescription });
    } catch (parseErr) {
      console.error('[extract-materials] JSON parse error:', parseErr, 'Raw:', jsonStr.substring(0, 200));
      return NextResponse.json({ materials: [], laborDescription: '' });
    }
  } catch (error) {
    console.error('[extract-materials] Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[extract-materials] Stack:', stack);
    return NextResponse.json({ error: message, detail: stack?.substring(0, 500) }, { status: 500 });
  }
}
