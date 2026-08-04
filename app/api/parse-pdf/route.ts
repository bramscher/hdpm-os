import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { extractText } from 'unpdf';
import Anthropic from '@anthropic-ai/sdk';

// Increase timeout for OCR processing (Claude Vision can take a while)
export const maxDuration = 60; // seconds

// Minimum characters to consider a PDF as having extractable text
const MIN_TEXT_LENGTH = 50;

// Get Anthropic client for vision-based OCR
function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable is not set');
  }
  return new Anthropic({ apiKey });
}

/**
 * Use Claude's vision to extract text from a PDF that appears to be scanned
 * We send the PDF as base64 and ask Claude to extract the text
 */
async function extractWithVision(arrayBuffer: ArrayBuffer, fileName: string): Promise<string> {
  const anthropic = getAnthropic();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  console.log(`[OCR] Using Claude Vision to extract text from scanned PDF...`);
  console.log(`[OCR] Base64 length: ${base64.length} chars (${Math.round(base64.length / 1024)} KB)`);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    thinking: { type: 'disabled' },
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
            text: `This PDF appears to be a scanned document. Please extract ALL text content from this document exactly as it appears. Preserve the original formatting, line breaks, and structure as much as possible. Do not summarize or paraphrase - extract the raw text content only. If there are multiple pages, include all pages with "--- Page Break ---" between them.`,
          },
        ],
      },
    ],
  });

  const textContent = response.content[0];
  if (textContent.type === 'text') {
    return textContent.text;
  }

  throw new Error('Unexpected response format from Claude Vision');
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { error: 'File must be a PDF' },
        { status: 400 }
      );
    }

    // Convert file to ArrayBuffer and create a copy for potential OCR use
    const arrayBuffer = await file.arrayBuffer();
    // Create a copy of the buffer since unpdf may detach the original
    const bufferCopy = arrayBuffer.slice(0);

    // First, try to extract text using unpdf (for text-based PDFs)
    console.log(`[PDF] Processing file: ${file.name}, size: ${file.size} bytes`);
    console.log('[PDF] Attempting text extraction...');

    let fullText = '';
    let totalPages = 0;

    try {
      const result = await extractText(arrayBuffer);
      totalPages = result.totalPages;
      // unpdf returns text as an array of strings (one per page), join them
      fullText = Array.isArray(result.text) ? result.text.join('\n\n') : String(result.text);
      console.log(`[PDF] unpdf extracted ${fullText.length} raw chars from ${totalPages} pages`);
    } catch (unpdfError) {
      console.log('[PDF] unpdf extraction failed, will use Vision:', unpdfError);
    }

    // Check if we got meaningful text
    const cleanText = fullText.replace(/\s+/g, ' ').trim();
    console.log(`[PDF] Clean text length: ${cleanText.length} chars`);
    console.log(`[PDF] Clean text preview: "${cleanText.substring(0, 100)}..."`);

    if (cleanText.length >= MIN_TEXT_LENGTH) {
      console.log(`[PDF] Text extraction successful: ${cleanText.length} characters from ${totalPages} pages`);
      return NextResponse.json({
        text: fullText,
        pages: totalPages,
        method: 'text',
      });
    }

    // If text extraction yielded little/no text, this is likely a scanned PDF
    // Use Claude's vision capabilities to extract text
    // Use the buffer copy since the original may have been detached
    console.log(`[PDF] Text extraction yielded only ${cleanText.length} chars (threshold: ${MIN_TEXT_LENGTH}), using Claude Vision for OCR...`);

    const ocrText = await extractWithVision(bufferCopy, file.name);
    console.log(`[PDF] Vision OCR complete: ${ocrText.length} characters`);

    return NextResponse.json({
      text: ocrText,
      pages: totalPages || 1,
      method: 'ocr',
    });
  } catch (error) {
    console.error('PDF parsing error:', error);
    // Log the full error for debugging
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to parse PDF: ${errorMessage}` },
      { status: 500 }
    );
  }
}
