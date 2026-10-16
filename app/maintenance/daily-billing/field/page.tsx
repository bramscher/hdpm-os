import {hasSection,requireCompanySession} from '@/lib/require-role';
import {redirect} from 'next/navigation';
import {Suspense} from 'react';
import FieldDay from './field-day';
export const metadata={title:'HDPM — Field Day'};
export default async function Page(){const guard=await requireCompanySession();if(!guard.ok)redirect('/login');if(!(await hasSection('field_time')).ok)redirect('/?denied=field_time');return <Suspense><FieldDay/></Suspense>;}
