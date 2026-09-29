import Anthropic from '@anthropic-ai/sdk';

export interface WorkOrderExtraction {
  materials: { description: string; amount: string }[];
  laborDescription: string;
}

/** Shared by invoice and estimate drafts; preserve scope, never invent costs. */
export async function extractWorkOrderItems(description: string): Promise<WorkOrderExtraction> {
  if (!description.trim()) return { materials: [], laborDescription: '' };
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('Work-order extraction is not configured');
  const response = await new Anthropic({ apiKey }).messages.create({
    model: 'claude-3-haiku-20240307', max_tokens: 4000,
    messages: [{ role: 'user', content: `You are parsing a property maintenance work order description for an invoice system. Separate each line/item into LABOR or MATERIALS.

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
${description.trim()}` }],
  });
  const content = response.content.find(block => block.type === 'text');
  if (!content || content.type !== 'text' || response.stop_reason === 'max_tokens') throw new Error('Incomplete work-order extraction');
  return parseWorkOrderExtraction(content.text);
}

export function parseWorkOrderExtraction(text: string): WorkOrderExtraction {
  const parsed = JSON.parse(text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text);
  if (!Array.isArray(parsed.materials) || typeof parsed.laborDescription !== 'string') throw new Error('Invalid work-order extraction');
  return {
    laborDescription: parsed.laborDescription,
    materials: parsed.materials.map((item: {description: unknown; amount: unknown}) => {
      if (typeof item.description !== 'string' || !item.description.trim()) throw new Error('Missing material description');
      const amount = Number(item.amount);
      return { description: item.description, amount: Number.isFinite(amount) && amount >= 0 ? String(amount) : '0' };
    }),
  };
}
