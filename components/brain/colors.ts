import type { VizLayer } from '@/lib/brain/viz';

/** Brain map palette, shared by the 3D scene and the DOM chrome around it. */
export const LAYER_COLOR: Record<VizLayer, string> = {
  core: '#f5b544',
  skills: '#4cc9f0',
  memory: '#9b8cff',
  routines: '#4ade80',
  integrations: '#f472b6',
};

/** Routine nodes take their last-run colour, like the routine calendar. */
export const STATUS_COLOR: Record<string, string> = {
  ok: '#4ade80',
  halted: '#f59e0b',
  skipped: '#f59e0b',
  error: '#ef4444',
  running: '#60a5fa',
  never: '#6b7280',
};
