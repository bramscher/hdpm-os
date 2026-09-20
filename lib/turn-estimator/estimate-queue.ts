export type EstimateStage = 'draft' | 'approval_pending' | 'approved' | 'billing' | 'closed';
export interface EstimateQueueItem {
  id: string;
  draftKind?: 'saved' | 'header';
  property: string;
  unit: string;
  workOrder: string;
  workOrderId: string | null;
  stage: EstimateStage;
  status: string;
  total: number | null;
  updatedAt: string;
  href: string;
  taskCount: number;
  undraftedTasks: number;
}
export function estimateStage(status: string, hasVersion: boolean, converted: boolean, tasks: number, allocated: number): EstimateStage {
  if (converted || (tasks > 0 && allocated === tasks)) return 'billing';
  if (['declined', 'cancelled', 'canceled', 'archived', 'superseded', 'void'].includes(status)) return 'closed';
  if (!hasVersion) return 'draft';
  if (status === 'approved') return 'approved';
  return 'approval_pending';
}
