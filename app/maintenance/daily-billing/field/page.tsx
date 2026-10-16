import {requireCompanySession} from '@/lib/require-role';
import {redirect} from 'next/navigation';
import {Suspense} from 'react';
import FieldDay from './field-day';
export const metadata={title:'HDPM — Field Day'};
export default async function Page(){const guard=await requireCompanySession();if(!guard.ok)redirect('/login');return <Suspense><FieldDay/></Suspense>;}
