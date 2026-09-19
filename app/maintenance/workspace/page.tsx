import { requireRole } from '@/lib/require-role';
import { redirect } from 'next/navigation';
import MaintenanceWorkspace from './workspace';
export const metadata={title:'HDPM — Maintenance workspace'};
export default async function Page(){const g=await requireRole('admin','manager','pm','maintenance','finance');if(!g.ok)redirect('/maintenance/field');return <MaintenanceWorkspace/>;}
