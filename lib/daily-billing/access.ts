import {canIssueInvoices,isInvoiceCoordinator} from '@/lib/invoice-permissions';
export function dailyBillingAccess(role:string,email:string){return {office:canIssueInvoices(role)||(role==='staff'&&isInvoiceCoordinator(email)),admin:role==='admin',allowed:!['read_only','inspector','front_desk'].includes(role)};}
export function validateDailyPeriod(from:string,to:string){
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>92)throw new Error('Choose a valid period of 93 days or less.');
}
