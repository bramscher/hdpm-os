import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/knowledge/source?url=<source_url>
 *
 * Returns a cited source's full content for the canvas source viewer,
 * reassembled from knowledge_chunks rows sharing the source_url. Notion SOPs
 * are chunked with ~200-char overlap ('part i/N' in source_section); adjacent
 * chunks are stitched by locating the next chunk's head inside the previous
 * chunk's tail. ORS sections are single chunks.
 */

/** Join overlapping sequential chunks back into one continuous text. */
function stitchChunks(contents: string[]): string {
  if (contents.length === 0) return '';
  let out = contents[0];
  for (let i = 1; i < contents.length; i++) {
    const next = contents[i];
    const probe = next.slice(0, 120);
    const tail = out.slice(-500);
    const idx = probe.length >= 30 ? tail.indexOf(probe) : -1;
    if (idx >= 0) {
      out = out.slice(0, out.length - tail.length + idx) + next;
    } else {
      out = `${out}\n\n${next}`;
    }
  }
  return out;
}

function partNumber(section: string | null): number {
  const m = /part (\d+)\//.exec(section ?? '');
  return m ? parseInt(m[1], 10) : 1;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url).searchParams.get('url');
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('knowledge_chunks')
      .select('content, source_type, source_title, source_url, source_section')
      .eq('source_url', url);

    if (error) {
      console.error('[knowledge/source] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    const rows = [...data].sort(
      (a, b) => partNumber(a.source_section) - partNumber(b.source_section)
    );
    const content = stitchChunks(rows.map((r) => r.content as string));

    return NextResponse.json({
      title: rows[0].source_title,
      url: rows[0].source_url,
      type: rows[0].source_type,
      section: rows.length > 1 ? null : rows[0].source_section,
      content,
      parts: rows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load source';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
