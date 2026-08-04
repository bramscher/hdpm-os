import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { extractText } from 'unpdf';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable is not set');
  }
  return new Anthropic({ apiKey });
}

async function extractWithVision(arrayBuffer: ArrayBuffer): Promise<string> {
  const anthropic = getAnthropic();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          },
          {
            type: 'text',
            text: 'Extract ALL text content from this work order document exactly as it appears, including every section, table, and field. Pay special attention to the Details table (Account, Statement Description, Amount) and include every row.',
          },
        ],
      },
    ],
  });

  const textContent = response.content[0];
  if (textContent.type === 'text') return textContent.text;
  throw new Error('Unexpected response format from Claude Vision');
}

interface ParsedWorkOrder {
  wo_number: string;
  status: string;
  property_name: string;
  property_address: string;
  unit: string;
  description: string;
  completed_date: string;
  scheduled_date: string;
  created_date: string;
  category: string;
  assigned_to: string;
  technician: string;
  technician_notes: string;
  permission_to_enter: string;
  maintenance_limit: string;
  pets: string;
  estimate_amount: string;
  vendor_instructions: string;
  property_notes: string;
  created_by: string;
  task_items: string[];
  line_items: Array<{
    account: string;
    description: string;
    amount: string;
    type: 'labor' | 'materials' | 'other';
  }>;
  total_amount: string;
  labor_amount: string;
  materials_amount: string;
}

async function extractWorkOrderFields(text: string): Promise<ParsedWorkOrder> {
  const anthropic = getAnthropic();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `You are parsing an AppFolio work order PDF for a property management company. Extract ALL fields into structured JSON. Return ONLY valid JSON, no other text.

There are TWO types of work orders:
1. FINANCIAL WOs: Have a "Details" table with columns (Account, Statement Description, Amount). Extract every row as a line item with the amount.
2. TASK-LIST WOs: Have a detailed Description section listing individual tasks to complete, plus a "Technician's Notes" section with paragraph descriptions of completed work. These may NOT have dollar amounts — extract each task into the task_items array (NOT as separate line items). The invoice form will roll all labor tasks into a single consolidated "Labor" line.

Return this exact JSON structure:
{
  "wo_number": "work order number (e.g. 40746-4)",
  "status": "work order status (e.g. Work Done, Scheduled, Completed, Open)",
  "property_name": "property/complex name from the Job Site field",
  "property_address": "full street address with city, state, zip from Job Site",
  "unit": "unit number if applicable",
  "description": "combine the Description section into a clean summary — keep ALL detail about what was done",
  "completed_date": "YYYY-MM-DD format or empty string",
  "scheduled_date": "YYYY-MM-DD format or empty string",
  "created_date": "YYYY-MM-DD format or empty string",
  "category": "work category (e.g. general maintenance, plumbing, electrical, HVAC, appliance, painting, turnover)",
  "assigned_to": "assigned user(s) or empty string",
  "technician": "Created By name or empty string",
  "technician_notes": "full text of the Technician's Notes section — paragraph descriptions of completed work. Include ALL detail. Empty string if none.",
  "permission_to_enter": "permission to enter value (e.g. N/A, Yes, No)",
  "maintenance_limit": "dollar amount as string (e.g. 200.00) or empty string",
  "pets": "pet information or empty string",
  "estimate_amount": "estimate amount as string or empty string",
  "vendor_instructions": "vendor instructions text or empty string",
  "property_notes": "property notes text or empty string",
  "created_by": "Created By name or empty string",
  "task_items": [
    "Each individual task from the Description section as a separate string",
    "e.g. Fix plug in living room",
    "e.g. Replace the seal on the refrigerator door Model # WRF535SMBM00"
  ],
  "line_items": [
    {
      "account": "GL account code or empty string",
      "description": "line item description",
      "amount": "amount as number string, no $ sign (e.g. 90.50). Use 0 if no amount listed.",
      "type": "labor or materials or other"
    }
  ],
  "total_amount": "total dollar amount, no $ sign, or empty string",
  "labor_amount": "labor cost if separately listed, or empty string",
  "materials_amount": "materials cost if separately listed, or empty string"
}

Rules:
- FINANCIAL WOs: line_items MUST contain every row from the Details table.
- TASK-LIST WOs (no Details table): Put labor tasks into task_items. The UI will create a consolidated "Labor" line from task_items. However, if MATERIALS are mentioned anywhere in the work order (description, technician notes, task list, or any other section) with specific item names and optionally prices, extract EACH material as a SEPARATE entry in line_items with type "materials". Examples of materials: faucet cartridge, door stop, light bulb, O-ring, filter, outlet cover, breaker, etc. Include the cost if mentioned, otherwise use "0" for the amount.
- task_items: ALWAYS extract every individual task line from the Description section as separate strings. These are usually short lines like "Fix plug in living room" or "Replace door stop in hall bathroom".
- technician_notes: Extract the FULL text of any paragraph-form notes about completed work. These often appear after the task list and describe what was actually done in detail.
- For the property_name, use the complex/property name (e.g. "Slivka 151 - Slivka 151") not the management company name.
- For the property_address, use the actual street address of the Job Site.
- For amounts, use numbers only, no $ signs.
- Use empty string "" for any field not found. Use [] for empty arrays.

Work Order Text:
${text}`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response format');

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = content.text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  return JSON.parse(jsonStr);
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 });
    }

    console.log(`[WO-PDF] Processing: ${file.name}, size: ${file.size} bytes`);

    // Step 1: Extract text from PDF
    const arrayBuffer = await file.arrayBuffer();
    const bufferCopy = arrayBuffer.slice(0);

    let extractedText = '';

    try {
      const result = await extractText(arrayBuffer);
      const fullText = Array.isArray(result.text) ? result.text.join('\n\n') : String(result.text);
      const cleanText = fullText.replace(/\s+/g, ' ').trim();

      if (cleanText.length >= 50) {
        extractedText = fullText;
        console.log(`[WO-PDF] Text extraction: ${cleanText.length} chars`);
      }
    } catch {
      console.log('[WO-PDF] Text extraction failed, using Vision');
    }

    if (!extractedText) {
      extractedText = await extractWithVision(bufferCopy);
      console.log(`[WO-PDF] Vision OCR: ${extractedText.length} chars`);
    }

    // Step 2: Use Claude to extract structured fields
    const parsed = await extractWorkOrderFields(extractedText);
    console.log(`[WO-PDF] Extracted: WO#${parsed.wo_number}, ${parsed.line_items?.length || 0} line items, ${parsed.task_items?.length || 0} tasks, total=${parsed.total_amount}`);

    // Convert to flat fields map for backward compat + include structured data
    const fields: Record<string, unknown> = {
      wo_number: parsed.wo_number,
      status: parsed.status,
      property_name: parsed.property_name,
      property_address: parsed.property_address,
      unit: parsed.unit,
      description: parsed.description,
      completed_date: parsed.completed_date,
      scheduled_date: parsed.scheduled_date,
      created_date: parsed.created_date,
      category: parsed.category,
      assigned_to: parsed.assigned_to,
      technician: parsed.technician,
      technician_notes: parsed.technician_notes,
      permission_to_enter: parsed.permission_to_enter,
      maintenance_limit: parsed.maintenance_limit,
      pets: parsed.pets,
      estimate_amount: parsed.estimate_amount,
      vendor_instructions: parsed.vendor_instructions,
      property_notes: parsed.property_notes,
      created_by: parsed.created_by,
      labor_amount: parsed.labor_amount,
      materials_amount: parsed.materials_amount,
      total_amount: parsed.total_amount,
      task_items: parsed.task_items || [],
      line_items: parsed.line_items || [],
    };

    return NextResponse.json({
      fields,
      rawText: extractedText,
      fileName: file.name,
    });
  } catch (error) {
    console.error('WO PDF parse error:', error);
    const message = error instanceof Error ? error.message : 'Failed to parse work order PDF';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
