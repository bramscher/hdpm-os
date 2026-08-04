import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

console.log('=== Testing Full RAG Pipeline ===\n');

// Check env vars
console.log('Environment Variables:');
console.log('- SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Set' : '❌ Missing');
console.log('- SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? `✅ Set (${process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 20)}...)` : '❌ Missing');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing');
console.log('- ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function test() {
  try {
    // Step 1: Test OpenAI embedding
    console.log('\n1. Testing OpenAI embedding...');
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'oregon chapter 90',
    });
    const embedding = embeddingResponse.data[0].embedding;
    console.log('   ✅ Generated embedding with', embedding.length, 'dimensions');

    // Step 2: Test Supabase RPC
    console.log('\n2. Testing Supabase vector search...');
    const { data: chunks, error } = await supabase.rpc('match_knowledge_chunks', {
      query_embedding: embedding,
      threshold: 0.5,
      count: 5,
    });

    if (error) {
      console.log('   ❌ Error:', error.message);
      return;
    }
    console.log('   ✅ Found', chunks?.length || 0, 'matching chunks');

    if (chunks && chunks.length > 0) {
      console.log('   First chunk preview:', chunks[0].content?.substring(0, 100) + '...');
    }

    // Step 3: Test Anthropic
    console.log('\n3. Testing Anthropic Claude...');
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      thinking: { type: 'disabled' },
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Say "RAG test successful" in exactly 3 words.' }],
    });
    const response = message.content[0].type === 'text' ? message.content[0].text : 'No response';
    console.log('   ✅ Claude response:', response);

    console.log('\n=== All tests passed! ===');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.status) console.error('   Status:', err.status);
  }
}

test();
