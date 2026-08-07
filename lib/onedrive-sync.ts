/**
 * OneDrive/SharePoint document corpus for the HDPM Knowledge Chat.
 *
 * Crawls four folders in the team site's Shared Documents/General library
 * (Procedures, HDPM - Admin Forms, Owner Forms, Tenant Forms), extracts text
 * from pdf/docx/txt/md files, and ingests them as source_type 'onedrive_doc'
 * alongside the ORS and Notion corpora.
 *
 * Auth reuses the app-only Graph client credentials from lib/agents/graph.ts
 * (AZURE_TENANT_ID + AGENT_GRAPH_CLIENT_ID/SECRET). The "HDPM-OS Agent Mail"
 * registration already holds application Sites.Read.All (admin-consented),
 * which covers reading this SharePoint library's drive items — no extra
 * permission needed. (Files.Read.All would also work.) Without a suitable
 * grant every Graph call 403s and the sync reports failed.
 *
 * Incremental: knowledge_sync_state stores each file's Graph eTag; only
 * files whose eTag changed are re-downloaded and re-embedded, capped at
 * MAX_FILES_PER_RUN per invocation (first backfill takes a few runs; steady
 * state is near-free). Files that vanish from the folders are purged when a
 * crawl completes without listing errors.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { getAppOnlyGraphToken } from '@/lib/agents/graph';
import { chunkText, embedBatch, type CorpusSyncResult } from '@/lib/knowledge-sync';
import { extractText } from 'unpdf';
import JSZip from 'jszip';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Shared Documents library of hdpm.sharepoint.com/sites/HighDesertPropertyManagement. */
const TEAM_DRIVE_ID = 'b!gKi_bGbiyUqeKiDUyGKv5YlePVDvaUhOt11oNwwVw_CUfRnk7QyIRoyqOVqP7aJN';

/** Folders under Shared Documents/General chosen for the knowledge base (2026-08-06). */
const KNOWLEDGE_FOLDERS = [
  { name: 'Procedures', id: '01KFGIDECT2QMWKZG2MRGKZCVXSZUUHR3F' },
  { name: 'HDPM - Admin Forms', id: '01KFGIDECOG73RE7QGRFH2X2UYNJKC7V5A' },
  { name: 'Owner Forms', id: '01KFGIDEH5KXYTHIBNNFFLQY473UIGTZ7Y' },
  { name: 'Tenant Forms', id: '01KFGIDEGWZVO5DDUY2VG3J5GSMBMLMF4O' },
] as const;

const SOURCE_TYPE = 'onedrive_doc';
const SUPPORTED_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md']);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES_PER_RUN = 40;
const MAX_FOLDER_DEPTH = 8;

interface DriveFile {
  id: string;
  /** "Procedures / Subfolder / File.pdf" — used as source_title. */
  title: string;
  name: string;
  size: number;
  webUrl: string;
  etag: string;
}

interface SyncStateRow {
  source_key: string;
  etag: string | null;
  url: string | null;
  status: string;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

async function graphGet(token: string, url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`graph ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Recursively list files under a folder, following pagination. */
async function listFolderFiles(
  token: string,
  folderId: string,
  path: string,
  out: DriveFile[],
  depth: number
): Promise<void> {
  if (depth > MAX_FOLDER_DEPTH) return;
  let url: string | undefined =
    `${GRAPH_BASE}/drives/${TEAM_DRIVE_ID}/items/${folderId}/children` +
    `?$top=200&$select=id,name,size,file,folder,webUrl,eTag`;
  while (url) {
    const data = await graphGet(token, url);
    const items = (data.value as Record<string, unknown>[]) ?? [];
    for (const item of items) {
      const name = item.name as string;
      if (item.folder) {
        await listFolderFiles(token, item.id as string, `${path} / ${name}`, out, depth + 1);
      } else if (item.file) {
        out.push({
          id: item.id as string,
          title: `${path} / ${name}`,
          name,
          size: (item.size as number) ?? 0,
          webUrl: item.webUrl as string,
          etag: (item.eTag as string) ?? '',
        });
      }
    }
    url = data['@odata.nextLink'] as string | undefined;
  }
}

/**
 * Download a drive item's content. Graph answers with a 302 to a pre-signed
 * storage URL; follow it manually so the Authorization header isn't
 * forwarded to the storage host (which rejects double-auth requests).
 */
async function downloadFile(token: string, itemId: string): Promise<ArrayBuffer> {
  const res = await fetch(`${GRAPH_BASE}/drives/${TEAM_DRIVE_ID}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) throw new Error('graph content redirect without location');
    const download = await fetch(location);
    if (!download.ok) throw new Error(`content download ${download.status}`);
    return download.arrayBuffer();
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`graph content ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.arrayBuffer();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x?[0-9a-fA-F]+;/g, ' ');
}

/** docx is a zip; the document body text lives in word/document.xml <w:t> runs. */
async function docxToText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file('word/document.xml');
  if (!doc) return '';
  const xml = await doc.async('string');
  return decodeXmlEntities(
    xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const result = await extractText(buf);
  const text = Array.isArray(result.text) ? result.text.join('\n\n') : String(result.text);
  return text.replace(/[ \t]+/g, ' ').trim();
}

async function fileToText(file: DriveFile, buf: ArrayBuffer): Promise<string> {
  const ext = extensionOf(file.name);
  if (ext === 'pdf') return pdfToText(buf);
  if (ext === 'docx') return docxToText(buf);
  return new TextDecoder('utf-8', { fatal: false }).decode(buf).trim();
}

async function loadSyncState(): Promise<Map<string, SyncStateRow>> {
  const supabase = getSupabaseAdmin();
  const state = new Map<string, SyncStateRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('knowledge_sync_state')
      .select('source_key, etag, url, status')
      .eq('source_type', SOURCE_TYPE)
      .range(from, from + 999);
    if (error) throw new Error(`sync state read failed: ${error.message}`);
    for (const row of data ?? []) state.set(row.source_key, row as SyncStateRow);
    if (!data || data.length < 1000) break;
  }
  return state;
}

export interface OneDriveSyncResult extends CorpusSyncResult {
  files: number;
  /** Changed files left unprocessed by the per-run cap — drained by the next run. */
  pending: number;
  removed: number;
}

/** Crawl the knowledge folders and refresh the onedrive_doc corpus. */
export async function syncOneDriveDocs(): Promise<OneDriveSyncResult> {
  const supabase = getSupabaseAdmin();
  const result: OneDriveSyncResult = {
    updated: 0, failed: 0, skipped: 0, chunks: 0, files: 0, pending: 0, removed: 0,
  };

  const token = await getAppOnlyGraphToken();
  if (!token) {
    console.warn('[onedrive-sync] Graph app-only env not configured — skipping');
    result.skipped = 1;
    return result;
  }

  // Crawl. A folder that fails to list disables stale-row cleanup for the
  // whole run so its files aren't mistaken for deletions.
  const files: DriveFile[] = [];
  let listingComplete = true;
  for (const folder of KNOWLEDGE_FOLDERS) {
    try {
      await listFolderFiles(token, folder.id, folder.name, files, 0);
    } catch (err) {
      console.error(`[onedrive-sync] listing "${folder.name}" failed:`, err instanceof Error ? err.message : err);
      listingComplete = false;
      result.failed++;
    }
  }
  result.files = files.length;

  const state = await loadSyncState();

  // Partition: unchanged (etag match) / needs work.
  const todo: DriveFile[] = [];
  for (const file of files) {
    const prev = state.get(file.id);
    if (prev && prev.etag === file.etag) {
      result.skipped++;
      continue;
    }
    todo.push(file);
  }

  let processed = 0;
  for (let i = 0; i < todo.length; i++) {
    const file = todo[i];
    if (processed >= MAX_FILES_PER_RUN) {
      result.pending = todo.length - i;
      break;
    }

    const ext = extensionOf(file.name);
    const prev = state.get(file.id);
    try {
      let status: 'indexed' | 'empty' | 'too_large' | 'unsupported';
      let chunkCount = 0;

      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        status = 'unsupported';
      } else if (file.size > MAX_FILE_BYTES) {
        status = 'too_large';
      } else {
        processed++;
        const text = await fileToText(file, await downloadFile(token, file.id));
        if (text.length < 40) {
          // Usually a scanned PDF with no text layer.
          status = 'empty';
        } else {
          const chunks = chunkText(`${file.title}\n\n${text}`);
          const embeddings = await embedBatch(chunks);

          // Replace-per-file; also clear rows under the pre-rename URL.
          const urls = prev?.url && prev.url !== file.webUrl ? [prev.url, file.webUrl] : [file.webUrl];
          const { error: delErr } = await supabase
            .from('knowledge_chunks')
            .delete()
            .eq('source_type', SOURCE_TYPE)
            .in('source_url', urls);
          if (delErr) throw new Error(delErr.message);

          const rows = chunks.map((content, i) => ({
            content,
            embedding: embeddings[i],
            source_type: SOURCE_TYPE,
            source_title: file.title,
            source_url: file.webUrl,
            source_section: chunks.length > 1 ? `part ${i + 1}/${chunks.length}` : null,
          }));
          const { error: insErr } = await supabase.from('knowledge_chunks').insert(rows);
          if (insErr) throw new Error(insErr.message);

          status = 'indexed';
          chunkCount = rows.length;
          result.updated++;
          result.chunks += chunkCount;
        }
      }

      const { error: stateErr } = await supabase.from('knowledge_sync_state').upsert({
        source_type: SOURCE_TYPE,
        source_key: file.id,
        etag: file.etag,
        url: file.webUrl,
        title: file.title,
        status,
        chunk_count: chunkCount,
        updated_at: new Date().toISOString(),
      });
      if (stateErr) throw new Error(`state upsert: ${stateErr.message}`);
    } catch (err) {
      console.error(`[onedrive-sync] "${file.title}" failed:`, err instanceof Error ? err.message : err);
      result.failed++;
    }
  }

  // Purge files that disappeared from the folders (only after a full listing).
  if (listingComplete && files.length > 0) {
    const seen = new Set(files.map((f) => f.id));
    const stale = [...state.values()].filter((row) => !seen.has(row.source_key));
    if (stale.length > 0) {
      const staleUrls = stale.map((r) => r.url).filter((u): u is string => Boolean(u));
      if (staleUrls.length > 0) {
        await supabase
          .from('knowledge_chunks')
          .delete()
          .eq('source_type', SOURCE_TYPE)
          .in('source_url', staleUrls);
      }
      await supabase
        .from('knowledge_sync_state')
        .delete()
        .eq('source_type', SOURCE_TYPE)
        .in('source_key', stale.map((r) => r.source_key));
      result.removed = stale.length;
    }
  }

  return result;
}
