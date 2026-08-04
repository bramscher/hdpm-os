/**
 * Brain embeddings — same model as the knowledge base (text-embedding-3-small,
 * 1536 dims) so quality/dimension assumptions stay uniform across stores.
 */

import OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

let _openai: OpenAI | null = null;
function client(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export async function embedText(text: string): Promise<number[]> {
  const res = await client().embeddings.create({ model: EMBEDDING_MODEL, input: text });
  return res.data[0].embedding;
}

/** Batched embedding (OpenAI accepts arrays; keep batches modest). */
export async function embedBatch(texts: string[], batchSize = 64): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await client().embeddings.create({ model: EMBEDDING_MODEL, input: batch });
    for (const d of res.data) out.push(d.embedding);
  }
  return out;
}
