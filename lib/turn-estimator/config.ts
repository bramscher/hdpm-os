/**
 * Turn Estimator — effective-dated globals (turn_estimator_config singleton).
 * Keeps tolerances / internal cost rate / default limit out of business logic.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { type EstimatorConfig, DEFAULT_ESTIMATOR_CONFIG } from './types';

export async function getEstimatorConfig(): Promise<EstimatorConfig> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('turn_estimator_config')
      .select('config')
      .eq('id', 'singleton')
      .maybeSingle();
    if (error || !data?.config) return { ...DEFAULT_ESTIMATOR_CONFIG };
    return { ...DEFAULT_ESTIMATOR_CONFIG, ...(data.config as Partial<EstimatorConfig>) };
  } catch {
    return { ...DEFAULT_ESTIMATOR_CONFIG };
  }
}
