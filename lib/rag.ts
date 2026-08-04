import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {
  searchKnowledgeChunks,
  searchKnowledgeFulltext,
  searchKnowledgePhrase,
  searchKnowledgeSubstring,
  KnowledgeChunk,
  FulltextChunk,
} from './supabase';

// Lazy initialization to avoid build-time issues
let _openai: OpenAI | null = null;
let _anthropic: Anthropic | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return _openai;
}

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    // Try ANTHROPIC_API_KEY first, then fall back to CLAUDE_API_KEY
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable is not set');
    }
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

// Source type icons mapping
export const SOURCE_ICONS: Record<string, string> = {
  ors_90: '⚖️',
  notion_sop: '📘',
  loom_video: '🎬',
  policy_doc: '📄',
};

// Types for RAG response
export interface Source {
  id: string;
  title: string;
  url: string;
  type: string;
  icon: string;
  section: string | null;
}

export interface RAGResponse {
  answer: string;
  sources: Source[];
}

/**
 * Query expansion mappings for common terms
 * Maps colloquial/common terms to their legal equivalents in ORS 90
 */
const QUERY_EXPANSIONS: Record<string, string[]> = {
  // Animal-related terms
  'emotional support animal': ['assistance animal', 'service animal', 'pet', 'animal accommodation'],
  'esa': ['assistance animal', 'service animal', 'emotional support animal'],
  'support animal': ['assistance animal', 'service animal', 'pet'],
  'service dog': ['service animal', 'assistance animal'],
  'therapy animal': ['assistance animal', 'service animal'],

  // Deposit-related terms
  'deposit': ['security deposit', 'prepaid rent', 'last month rent'],
  'move out': ['termination', 'vacate', 'security deposit', 'accounting'],
  'move-out': ['termination', 'vacate', 'security deposit', 'accounting'],

  // Eviction-related terms
  'eviction': ['termination', 'for cause', 'notice', 'unlawful detainer'],
  'evict': ['terminate', 'termination notice', 'for cause'],
  'kick out': ['terminate', 'termination', 'eviction'],

  // Rent-related terms
  'late fee': ['late charge', 'late rent', 'rent payment'],
  'rent increase': ['rent raise', 'increased rent'],
  'raise rent': ['rent increase', 'increased rent'],

  // Repair-related terms
  'repair': ['maintenance', 'habitability', 'essential services'],
  'fix': ['repair', 'maintenance', 'habitability'],
  'broken': ['repair', 'maintenance', 'defective'],

  // Lease-related terms
  'lease': ['rental agreement', 'tenancy'],
  'month to month': ['periodic tenancy', 'month-to-month'],
  'break lease': ['early termination', 'terminate tenancy'],
};

/**
 * Expand a query with related legal terms
 */
function expandQuery(query: string): string {
  const lowerQuery = query.toLowerCase();
  const expansions: string[] = [];

  for (const [term, relatedTerms] of Object.entries(QUERY_EXPANSIONS)) {
    if (lowerQuery.includes(term)) {
      expansions.push(...relatedTerms);
    }
  }

  if (expansions.length === 0) {
    return query;
  }

  // Deduplicate and append expansions
  const uniqueExpansions = [...new Set(expansions)];
  return `${query} ${uniqueExpansions.join(' ')}`;
}

/**
 * Generate embedding for a query using OpenAI's text-embedding-3-small model
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Options for searchKnowledge function
 */
export interface SearchKnowledgeOptions {
  enableQueryExpansion?: boolean; // Default: false (reduces noise)
  minSimilarity?: number;         // Default: 0.50 (quality floor)
  maxResults?: number;            // Default: 15 (more candidates)
}

/**
 * Search the knowledge base for relevant chunks
 * Retrieves candidates and applies quality filtering
 */
export async function searchKnowledge(
  query: string,
  threshold: number = 0.30, // Keep DB threshold low to get candidates; app-level minSimilarity handles quality
  count: number = 15,       // Increased from 5 for more candidates
  options?: SearchKnowledgeOptions
): Promise<KnowledgeChunk[]> {
  const ENABLE_QUERY_EXPANSION = options?.enableQueryExpansion ?? false;
  const MIN_SIMILARITY = options?.minSimilarity ?? 0.50;
  const MAX_RESULTS = options?.maxResults ?? count;

  let searchQuery = query;

  // Only expand query if explicitly enabled (disabled by default to reduce noise)
  if (ENABLE_QUERY_EXPANSION) {
    const expandedQuery = expandQuery(query);
    const wasExpanded = expandedQuery !== query;
    if (wasExpanded) {
      searchQuery = expandedQuery;
      console.log(`[RAG] Query expanded: "${query}" -> "${searchQuery}"`);
    }
  }

  console.log(`[RAG] Searching with query: "${searchQuery}"`);
  console.log(`[RAG] Options: { enableQueryExpansion: ${ENABLE_QUERY_EXPANSION}, minSimilarity: ${MIN_SIMILARITY}, maxResults: ${MAX_RESULTS} }`);

  const embedding = await generateEmbedding(searchQuery);
  const chunks = await searchKnowledgeChunks(embedding, threshold, MAX_RESULTS);

  // Apply quality filtering - only keep results above minimum similarity
  const filteredChunks = chunks.filter(c => (c.similarity || 0) >= MIN_SIMILARITY);

  // Log retrieval results for debugging
  if (chunks.length > 0) {
    const similarities = chunks.map(c => c.similarity || 0);
    const minSim = Math.min(...similarities);
    const maxSim = Math.max(...similarities);
    const avgSim = similarities.reduce((a, b) => a + b, 0) / similarities.length;

    console.log(`[RAG] Retrieved ${chunks.length} chunks, filtered to ${filteredChunks.length} high-quality matches`);
    console.log(`[RAG] Similarity range: ${minSim.toFixed(2)} - ${maxSim.toFixed(2)} (avg: ${avgSim.toFixed(2)})`);
    console.log(`[RAG] Sections: ${chunks.map(c => c.source_section || 'none').join(', ')}`);
  } else {
    console.log(`[RAG] No chunks found with threshold ${threshold}`);
  }

  // Return filtered results, or fall back to top 5 if all filtered out (graceful degradation)
  const finalResults = filteredChunks.length > 0 ? filteredChunks : chunks.slice(0, 5);

  return finalResults;
}

// ============================================
// Hybrid Search (Vector + Full-Text)
// ============================================

/**
 * Detect the intent of a query to choose the best search strategy
 */
type SearchIntent = 'phrase_lookup' | 'section_lookup' | 'keyword' | 'semantic';

function detectSearchIntent(query: string): SearchIntent {
  const lower = query.toLowerCase();

  // Quoted phrases — user wants exact language
  // e.g., 'where does it say "reasonable wear and tear"'
  const hasQuotedPhrase = /["'"](.+?)["'"]/.test(query);
  if (hasQuotedPhrase) {
    return 'phrase_lookup';
  }

  // ORS section number reference — user wants a specific section
  // e.g., "what does 90.300 say" or "show me ORS 90.394"
  const hasOrsReference = /\b(ors\s*)?90\.\d{3}\b/i.test(query);
  if (hasOrsReference) {
    return 'section_lookup';
  }

  // Language lookup patterns — user is searching for specific wording
  // e.g., "which section mentions...", "where does it say...", "find the part about..."
  const lookupPatterns = [
    /which\s+(section|part|ors)/i,
    /where\s+(does|do)\s+it\s+(say|mention|state|define|address)/i,
    /find\s+(the\s+)?(section|part|language|wording|provision)/i,
    /what\s+section\s+(covers?|addresses?|mentions?|talks?\s+about)/i,
    /is\s+there\s+(a\s+)?(section|provision|rule)\s+(about|for|on|regarding)/i,
    /does\s+(ors|the\s+law)\s+(say|mention|address|cover|define)/i,
    /look\s+up/i,
    /search\s+for/i,
  ];

  if (lookupPatterns.some(pattern => pattern.test(lower))) {
    return 'keyword';
  }

  // Default to semantic search
  return 'semantic';
}

/**
 * Extract a quoted phrase from a query, if present
 */
function extractQuotedPhrase(query: string): string | null {
  const match = query.match(/["'"](.+?)["'"]/);
  return match ? match[1] : null;
}

/**
 * Extract an ORS section number from a query
 */
function extractOrsSection(query: string): string | null {
  const match = query.match(/\b(?:ors\s*)?(\d{2,3}\.\d{3})\b/i);
  return match ? match[1] : null;
}

/**
 * Convert fulltext results to KnowledgeChunk format for compatibility
 */
function fulltextToKnowledgeChunks(results: FulltextChunk[]): KnowledgeChunk[] {
  return results.map(r => ({
    id: r.id,
    content: r.content,
    source_type: r.source_type,
    source_title: r.source_title,
    source_url: r.source_url,
    source_section: r.source_section,
    similarity: r.rank, // Use rank as a proxy for similarity in display
  }));
}

/**
 * Merge and deduplicate results from vector and fulltext search
 * Boosts items that appear in both result sets
 */
function mergeSearchResults(
  vectorResults: KnowledgeChunk[],
  fulltextResults: KnowledgeChunk[],
  maxResults: number = 15
): KnowledgeChunk[] {
  const merged = new Map<string, KnowledgeChunk & { boost: number }>();

  // Add vector results
  for (const chunk of vectorResults) {
    merged.set(chunk.id, { ...chunk, boost: 1 });
  }

  // Add or boost fulltext results
  for (const chunk of fulltextResults) {
    if (merged.has(chunk.id)) {
      // Appears in both — boost the similarity score
      const existing = merged.get(chunk.id)!;
      existing.boost = 2;
      // Keep the higher similarity
      existing.similarity = Math.max(existing.similarity || 0, chunk.similarity || 0);
    } else {
      merged.set(chunk.id, { ...chunk, boost: 1 });
    }
  }

  // Sort: boosted items first, then by similarity
  const sorted = [...merged.values()].sort((a, b) => {
    if (a.boost !== b.boost) return b.boost - a.boost;
    return (b.similarity || 0) - (a.similarity || 0);
  });

  return sorted.slice(0, maxResults);
}

/**
 * Hybrid search: combines vector similarity search with full-text keyword search
 * Automatically detects query intent and chooses the best strategy
 */
export async function searchKnowledgeHybrid(
  query: string,
  options?: SearchKnowledgeOptions
): Promise<KnowledgeChunk[]> {
  const intent = detectSearchIntent(query);
  const maxResults = options?.maxResults ?? 15;

  console.log(`[RAG Hybrid] Query: "${query}"`);
  console.log(`[RAG Hybrid] Detected intent: ${intent}`);

  try {
    switch (intent) {
      case 'phrase_lookup': {
        // User wants exact phrase — prioritize phrase search, supplement with vector
        const phrase = extractQuotedPhrase(query) || query;
        console.log(`[RAG Hybrid] Phrase search for: "${phrase}"`);

        const [phraseResults, vectorResults] = await Promise.all([
          searchKnowledgePhrase(phrase, maxResults).then(fulltextToKnowledgeChunks),
          searchKnowledge(query, 0.30, maxResults, { ...options, enableQueryExpansion: false }),
        ]);

        console.log(`[RAG Hybrid] Phrase: ${phraseResults.length} results, Vector: ${vectorResults.length} results`);

        // Phrase results first, then supplement with vector
        if (phraseResults.length > 0) {
          return mergeSearchResults(phraseResults, vectorResults, maxResults);
        }
        // Fallback to substring search if phrase search found nothing
        const substringResults = await searchKnowledgeSubstring(phrase, maxResults).then(fulltextToKnowledgeChunks);
        if (substringResults.length > 0) {
          console.log(`[RAG Hybrid] Substring fallback: ${substringResults.length} results`);
          return mergeSearchResults(substringResults, vectorResults, maxResults);
        }
        return vectorResults;
      }

      case 'section_lookup': {
        // User wants a specific ORS section — substring search for the number
        const section = extractOrsSection(query);
        console.log(`[RAG Hybrid] Section lookup for: ${section}`);

        const [substringResults, vectorResults] = await Promise.all([
          searchKnowledgeSubstring(section || query, maxResults).then(fulltextToKnowledgeChunks),
          searchKnowledge(query, 0.30, maxResults, { ...options, enableQueryExpansion: false }),
        ]);

        console.log(`[RAG Hybrid] Substring: ${substringResults.length} results, Vector: ${vectorResults.length} results`);

        if (substringResults.length > 0) {
          return mergeSearchResults(substringResults, vectorResults, maxResults);
        }
        return vectorResults;
      }

      case 'keyword': {
        // User is looking for specific language — run both fulltext and vector in parallel
        console.log(`[RAG Hybrid] Keyword + Vector search`);

        const [fulltextResults, vectorResults] = await Promise.all([
          searchKnowledgeFulltext(query, maxResults).then(fulltextToKnowledgeChunks),
          searchKnowledge(query, 0.30, maxResults, { ...options, enableQueryExpansion: false }),
        ]);

        console.log(`[RAG Hybrid] Fulltext: ${fulltextResults.length} results, Vector: ${vectorResults.length} results`);

        return mergeSearchResults(vectorResults, fulltextResults, maxResults);
      }

      case 'semantic':
      default: {
        // Standard semantic question — vector search is best, supplement with fulltext
        console.log(`[RAG Hybrid] Semantic (vector primary) + Fulltext supplement`);

        const [vectorResults, fulltextResults] = await Promise.all([
          searchKnowledge(query, 0.30, maxResults, options),
          searchKnowledgeFulltext(query, maxResults).then(fulltextToKnowledgeChunks).catch(() => []),
        ]);

        console.log(`[RAG Hybrid] Vector: ${vectorResults.length} results, Fulltext: ${fulltextResults.length} results`);

        return mergeSearchResults(vectorResults, fulltextResults, maxResults);
      }
    }
  } catch (error) {
    // If hybrid search fails (e.g., fulltext not yet set up), fall back to vector-only
    console.error(`[RAG Hybrid] Error, falling back to vector-only:`, error);
    return searchKnowledge(query, 0.30, maxResults, options);
  }
}

/**
 * Build context from knowledge chunks with source references
 */
function buildContext(chunks: KnowledgeChunk[]): string {
  if (chunks.length === 0) {
    return 'No relevant information found in the knowledge base.';
  }

  return chunks
    .map((chunk, index) => {
      const sourceNum = index + 1;
      return `[Source ${sourceNum}] ${chunk.source_title}${chunk.source_section ? ` - ${chunk.source_section}` : ''}:\n${chunk.content}`;
    })
    .join('\n\n');
}

/**
 * Extract sources from chunks for the response
 */
function extractSources(chunks: KnowledgeChunk[]): Source[] {
  return chunks.map((chunk) => ({
    id: chunk.id,
    title: chunk.source_title,
    url: chunk.source_url,
    type: chunk.source_type,
    icon: SOURCE_ICONS[chunk.source_type] || '📄',
    section: chunk.source_section,
  }));
}

/**
 * Main RAG function: search knowledge base and generate response with Claude
 */
export async function askRAG(question: string): Promise<RAGResponse> {
  // Step 1: Hybrid search — vector + fulltext, auto-detects query intent
  const chunks = await searchKnowledgeHybrid(question, {
    enableQueryExpansion: false,
    minSimilarity: 0.50,
    maxResults: 15
  });

  // Step 2: Build context from retrieved chunks
  const context = buildContext(chunks);
  const sources = extractSources(chunks);

  // Step 3: Build the system prompt
  const systemPrompt = `You are the internal knowledge assistant for High Desert Property Management. Your role is to help property managers, leasing agents, and staff quickly find accurate information about landlord-tenant law, company policies, and procedures.

CONTEXT:
- This is an INTERNAL tool for High Desert Property Management staff only
- Users are professionals who need practical, actionable guidance
- Focus on Oregon landlord-tenant law (ORS Chapter 90) and HDPM's own procedures
- Always consider the landlord/property manager perspective when answering
- The knowledge base contains TWO corpora:
  1. The COMPLETE Oregon ORS Chapter 90 (163 sections covering residential landlord-tenant law, manufactured dwelling parks, and marinas)
  2. Every HDPM Standard Operating Procedure from the Notion SOP library (move-in/move-out, inspections, maintenance, key management, screening, front desk, HDPM-OS app procedures, and more)
- When a question touches company process ("how do we...", "what's our procedure for..."), answer from the SOPs; when it touches the law, answer from ORS 90; blend both when relevant (e.g., what the law requires AND how HDPM executes it)
- SOP sources link to the live Notion page — point the user there for the full procedure when your answer summarizes one

RESPONSE FORMAT:
1. Start with a brief, direct answer to the question
2. Use clear headers (## Header) to organize longer responses
3. Use bullet points for lists and requirements
4. Include specific ORS section numbers, timeframes, and limits when available
5. Add practical tips or warnings where relevant (e.g., "Important:", "Note:")

CITATIONS:
- Use inline citations [1], [2], etc. for ALL factual claims from the knowledge base
- Place citations immediately after the relevant statement
- Multiple citations can be grouped: [1][2]
- Always cite the specific ORS section number when referencing the law
- When referencing an SOP, name it (e.g., "per SOP: Routine Inspection") and cite it — the citation links to the actual Notion page

TONE:
- Professional but approachable
- Confident when information is clear
- Honest about limitations or ambiguities in the law
- Suggest consulting legal counsel for complex situations

If the knowledge base doesn't contain relevant information, say so clearly and suggest appropriate next steps (e.g., consult the company handbook, speak with a supervisor, or seek legal advice).

The sources are numbered [1] through [${sources.length}] in the context below.`;

  // Step 4: Call Claude API
  const message = await getAnthropic().messages.create({
    model: 'claude-sonnet-5',
    thinking: { type: 'disabled' },
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Context from knowledge base:\n\n${context}\n\nQuestion: ${question}`,
      },
    ],
  });

  // Extract the text response
  const answer = message.content[0].type === 'text'
    ? message.content[0].text
    : 'Unable to generate response.';

  return {
    answer,
    sources,
  };
}

/**
 * Build system prompt for RAG
 */
function buildSystemPrompt(sourcesCount: number): string {
  return `You are the internal knowledge assistant for High Desert Property Management. Your role is to help property managers, leasing agents, and staff quickly find accurate information about landlord-tenant law, company policies, and procedures.

CONTEXT:
- This is an INTERNAL tool for High Desert Property Management staff only
- Users are professionals who need practical, actionable guidance
- Focus on Oregon landlord-tenant law (ORS Chapter 90) and HDPM's own procedures
- Always consider the landlord/property manager perspective when answering
- The knowledge base contains TWO corpora:
  1. The COMPLETE Oregon ORS Chapter 90 (163 sections covering residential landlord-tenant law, manufactured dwelling parks, and marinas)
  2. Every HDPM Standard Operating Procedure from the Notion SOP library (move-in/move-out, inspections, maintenance, key management, screening, front desk, HDPM-OS app procedures, and more)
- When a question touches company process ("how do we...", "what's our procedure for..."), answer from the SOPs; when it touches the law, answer from ORS 90; blend both when relevant (e.g., what the law requires AND how HDPM executes it)
- SOP sources link to the live Notion page — point the user there for the full procedure when your answer summarizes one

RESPONSE FORMAT:
1. Start with a brief, direct answer to the question
2. Use clear headers (## Header) to organize longer responses
3. Use bullet points for lists and requirements
4. Include specific ORS section numbers, timeframes, and limits when available
5. Add practical tips or warnings where relevant (e.g., "Important:", "Note:")

CITATIONS:
- Use inline citations [1], [2], etc. for ALL factual claims from the knowledge base
- Place citations immediately after the relevant statement
- Multiple citations can be grouped: [1][2]
- Always cite the specific ORS section number when referencing the law
- When referencing an SOP, name it (e.g., "per SOP: Routine Inspection") and cite it — the citation links to the actual Notion page

TONE:
- Professional but approachable
- Confident when information is clear
- Honest about limitations or ambiguities in the law
- Suggest consulting legal counsel for complex situations

If the knowledge base doesn't contain relevant information, say so clearly and suggest appropriate next steps (e.g., consult the company handbook, speak with a supervisor, or seek legal advice).

The sources are numbered [1] through [${sourcesCount}] in the context below.`;
}

/**
 * Build system prompt for document analysis
 */
function buildDocumentAnalysisPrompt(sourcesCount: number, documentName?: string): string {
  return `You are the internal knowledge assistant for High Desert Property Management analyzing a document provided by staff.

CRITICAL INSTRUCTION:
The user has uploaded ${documentName ? `a document called "${documentName}"` : 'a document/email'} for you to analyze. You MUST read and analyze the ACTUAL CONTENT of their document (provided below) and explain how Oregon landlord-tenant law applies to their specific situation. Do NOT just describe what sources are available - actually analyze their document.

CONTEXT:
- This is an INTERNAL tool for High Desert Property Management staff only
- Users are professionals who need practical, actionable guidance
- Focus on Oregon landlord-tenant law (ORS Chapter 90) and company policies
- Always consider the landlord/property manager perspective when answering

YOUR TASK:
1. Read the user's document/correspondence carefully
2. Identify what the document is about (tenant complaint, notice, lease issue, etc.)
3. Quote or reference specific parts of their document when relevant
4. Explain which ORS 90 sections apply to their specific situation
5. Provide a recommended response or action plan

RESPONSE FORMAT:
## Document Summary
- Briefly describe what this document is (email from tenant, notice, complaint, etc.)
- Note the key issues or requests in the document

## Legal Analysis
- Cite specific ORS sections that apply
- Explain what the law requires in this situation
- Note any deadlines or timeframes

## Recommended Response
- Draft suggested language or outline a response
- Specify any required notices or forms
- Note any deadlines for landlord action

## Warnings/Risks (if applicable)
- Flag any potential legal issues
- Note if legal counsel should be consulted

CITATIONS:
- Use inline citations [1], [2], etc. when referencing the legal sources
- Always cite specific ORS section numbers

The legal reference sources are numbered [1] through [${sourcesCount}] in the context below.`;
}

/**
 * Streaming RAG function: search knowledge base and stream response from Claude
 * Optionally accepts document content for correspondence analysis
 */
export async function askRAGStream(
  question: string,
  documentContent?: string,
  documentName?: string
): Promise<{
  stream: AsyncIterable<string>;
  sources: Source[];
}> {
  // Log document analysis mode
  if (documentContent) {
    console.log(`[RAG] Document analysis mode: "${documentName || 'unnamed'}" (${documentContent.length} chars)`);
  }

  // Step 1: Hybrid search — vector + fulltext, auto-detects query intent
  // Don't pollute the search with document content - we want relevant ORS sections for the question
  const chunks = await searchKnowledgeHybrid(question, {
    enableQueryExpansion: false,
    minSimilarity: 0.50,
    maxResults: 15
  });

  // Step 2: Build context from retrieved chunks
  const context = buildContext(chunks);
  const sources = extractSources(chunks);

  // Step 3: Build the appropriate system prompt
  const systemPrompt = documentContent
    ? buildDocumentAnalysisPrompt(sources.length, documentName)
    : buildSystemPrompt(sources.length);

  // Step 4: Build user message content
  // For document analysis: Document FIRST, then legal context, then question
  // This ensures the AI focuses on the document as the primary content
  let userContent = '';

  if (documentContent) {
    userContent += `=== USER'S DOCUMENT TO ANALYZE ===\n`;
    userContent += `Document: ${documentName || 'Uploaded Document'}\n\n`;
    userContent += `${documentContent}\n\n`;
    userContent += `=== END OF DOCUMENT ===\n\n`;
    userContent += `=== RELEVANT OREGON LAW (ORS 90) FOR REFERENCE ===\n\n${context}\n\n`;
    userContent += `=== USER'S QUESTION ===\n${question}`;
  } else {
    userContent += `Context from knowledge base:\n\n${context}\n\n`;
    userContent += `Question: ${question}`;
  }

  // Step 5: Create streaming response from Claude
  const streamResponse = await getAnthropic().messages.stream({
    model: 'claude-sonnet-5',
    thinking: { type: 'disabled' },
    max_tokens: 2048, // Increased for document analysis
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userContent,
      },
    ],
  });

  // Create an async generator that yields text chunks
  async function* textStream(): AsyncIterable<string> {
    for await (const event of streamResponse) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  return {
    stream: textStream(),
    sources,
  };
}
