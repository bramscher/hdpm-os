/** Company-brain types (Phase 1, Brief 1A — docs/hdpm-os/04). */

export type ChunkKind = 'fact' | 'summary' | 'inference' | 'agent_output' | 'human_correction';
export type ChunkDomain = 'ops' | 'company' | 'market';
export type Sensitivity = 'public' | 'internal' | 'restricted';

export interface IngestInput {
  content: string;
  kind: ChunkKind;
  /** Stable identity for idempotent re-ingest, e.g. 'docs/x.md#3'. */
  sourceKey?: string;
  sourceUrl?: string;
  sourceTable?: string;
  sourceId?: string;
  author?: string;           // 'human:<email>' | 'agent:<name>' | 'system'
  domain?: ChunkDomain;
  sensitivity?: Sensitivity;
  nodeId?: string;
  salience?: number;
}

export interface BrainMatch {
  id: string;
  node_id: string | null;
  kind: ChunkKind;
  domain: ChunkDomain;
  content: string;
  source_url: string | null;
  source_table: string | null;
  source_id: string | null;
  author: string;
  sensitivity: Sensitivity;
  salience: number;
  score: number;
}
