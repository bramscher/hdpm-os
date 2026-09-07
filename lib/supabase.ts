import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Types for our knowledge base
export interface KnowledgeChunk {
  id: string;
  content: string;
  source_type: 'ors_90' | 'loom_video' | 'policy_doc';
  source_title: string;
  source_url: string;
  source_section: string | null;
  similarity?: number;
}

// Lazy initialization to avoid build-time errors
let _supabaseClient: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

// Client-side Supabase client (uses publishable key)
export function getSupabaseClient(): SupabaseClient {
  if (!_supabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

    if (!url || !publishableKey) {
      throw new Error('Missing Supabase environment variables');
    }

    _supabaseClient = createClient(url, publishableKey);
  }
  return _supabaseClient;
}

// Server-side Supabase client (uses service role key for RPC calls)
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    _supabaseAdmin = createClient(url, serviceKey);
  }
  return _supabaseAdmin;
}

// Function to search knowledge chunks using pgvector
export async function searchKnowledgeChunks(
  queryEmbedding: number[],
  threshold: number = 0.7,
  count: number = 5
): Promise<KnowledgeChunk[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: queryEmbedding,
    threshold,
    count,
  });

  if (error) {
    console.error('Error searching knowledge chunks:', error);
    throw new Error(`Failed to search knowledge base: ${error.message}`);
  }

  return data as KnowledgeChunk[];
}

// ============================================
// Full-Text Search Functions
// ============================================

// Result type for full-text search (uses rank instead of similarity)
export interface FulltextChunk {
  id: string;
  content: string;
  source_type: 'ors_90' | 'loom_video' | 'policy_doc';
  source_title: string;
  source_url: string;
  source_section: string | null;
  rank: number;
  similarity?: number; // Added when merged with vector results
}

/**
 * Full-text keyword search using PostgreSQL tsvector
 * Good for general keyword queries like "late fee" or "security deposit"
 */
export async function searchKnowledgeFulltext(
  query: string,
  maxResults: number = 15
): Promise<FulltextChunk[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc('search_knowledge_fulltext', {
    search_query: query,
    max_results: maxResults,
  });

  if (error) {
    console.error('Error in fulltext search:', error);
    throw new Error(`Fulltext search failed: ${error.message}`);
  }

  return data as FulltextChunk[];
}

/**
 * Phrase search for exact or near-exact phrase matching
 * Good for "which section says 'reasonable wear and tear'"
 */
export async function searchKnowledgePhrase(
  phrase: string,
  maxResults: number = 15
): Promise<FulltextChunk[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc('search_knowledge_phrase', {
    search_phrase: phrase,
    max_results: maxResults,
  });

  if (error) {
    console.error('Error in phrase search:', error);
    throw new Error(`Phrase search failed: ${error.message}`);
  }

  return data as FulltextChunk[];
}

/**
 * Substring search using ILIKE for exact text matching
 * Good for finding specific ORS section numbers like "90.300"
 */
export async function searchKnowledgeSubstring(
  text: string,
  maxResults: number = 15
): Promise<FulltextChunk[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc('search_knowledge_substring', {
    search_text: text,
    max_results: maxResults,
  });

  if (error) {
    console.error('Error in substring search:', error);
    throw new Error(`Substring search failed: ${error.message}`);
  }

  return data as FulltextChunk[];
}
