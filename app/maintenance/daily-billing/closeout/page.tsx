import {hasSection,requireCompanySession} from '@/lib/require-role';
import {redirect} from 'next/navigation';
import {Suspense} from 'react';
import Closeout from './closeout';
export const metadata={title:'HDPM — Billing Closeout'};
export default async function Page(){const guard=await requireCompanySession();if(!guard.ok)redirect('/login');const access=await hasSection('billing_closeout');if(!access.ok)redirect('/?denied=billing_closeout');return <Suspense><Closeout admin={access.isAdmin}/></Suspense>;}
