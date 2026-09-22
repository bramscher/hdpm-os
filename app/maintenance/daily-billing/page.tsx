import {requireCompanySession} from '@/lib/require-role';
import {redirect} from 'next/navigation';
import DailyBillingReview from './review';
export const metadata={title:'HDPM — Daily Billing Review'};
export default async function Page(){const guard=await requireCompanySession();if(!guard.ok)redirect('/login');return <DailyBillingReview/>;}
