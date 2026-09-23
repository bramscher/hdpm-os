import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/require-role';
import StaffPermissions from './staff-permissions';
export const dynamic='force-dynamic';
export const metadata={title:'HDPM — Staff permissions'};
export default async function Page(){const guard=await requireRole('admin');if(!guard.ok)redirect('/');return <StaffPermissions/>;}
