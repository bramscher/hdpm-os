import { requireCompanySession } from '@/lib/require-role';
import { redirect } from 'next/navigation';
import MaintenanceWorkspace from '../workspace/workspace';
export const metadata={title:'HDPM Field — My Day'};
export default async function Page(){const g=await requireCompanySession();if(!g.ok)redirect('/login');return <MaintenanceWorkspace field/>;}
