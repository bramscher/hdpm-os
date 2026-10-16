import {requireCompanySession} from '@/lib/require-role';
import {redirect} from 'next/navigation';
import {Suspense} from 'react';
import Locations from './locations';
export const metadata={title:'HDPM — Stop Locations'};
export default async function Page(){const guard=await requireCompanySession();if(!guard.ok)redirect('/login');return <Suspense><Locations/></Suspense>;}
