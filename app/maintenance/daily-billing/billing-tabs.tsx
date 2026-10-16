import Link from 'next/link';
import './billing-tabs.css';

/** One tab bar across Daily Billing Review, Field time and Stop locations. Field time and locations are admin pages for now. */
export default function BillingTabs({active,admin}:{active:'review'|'field'|'locations';admin:boolean}){
 const tabs=[
  {key:'review',label:'Daily Billing Review',href:'/maintenance/daily-billing'},
  {key:'field',label:'Field time',href:'/maintenance/daily-billing/field'},
  ...(admin?[{key:'locations',label:'Stop locations',href:'/maintenance/daily-billing/locations'}]:[]),
 ].filter(t=>t.key!=='field'||admin||active==='field');
 return <div className="bt-bar"><div className="bt-wrap">
  <span className="bt-crumb">Maintenance · Work &amp; Billing</span>
  <nav aria-label="Billing pages" className="bt-tabs">{tabs.map(t=><Link key={t.key} href={t.href} aria-current={t.key===active?'page':undefined} className={t.key===active?'bt-tab bt-active':'bt-tab'}>{t.label}</Link>)}</nav>
 </div></div>;
}
