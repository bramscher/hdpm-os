import Link from 'next/link';
import './billing-tabs.css';

/** One tab bar across Daily Billing Review, Billing closeout, Field time and Stop locations. Closeout, field time and locations show to admins, or on their own page. */
export default function BillingTabs({active,admin}:{active:'review'|'field'|'locations'|'closeout';admin:boolean}){
 const tabs=[
  {key:'review',label:'Daily Billing Review',href:'/maintenance/daily-billing'},
  {key:'closeout',label:'Billing closeout',href:'/maintenance/daily-billing/closeout'},
  {key:'field',label:'Field time',href:'/maintenance/daily-billing/field'},
  ...(admin?[{key:'locations',label:'Stop locations',href:'/maintenance/daily-billing/locations'}]:[]),
 ].filter(t=>(t.key!=='field'&&t.key!=='closeout')||admin||active===t.key);
 return <div className="bt-bar"><div className="bt-wrap">
  <span className="bt-crumb">Maintenance · Work &amp; Billing</span>
  <nav aria-label="Billing pages" className="bt-tabs">{tabs.map(t=><Link key={t.key} href={t.href} aria-current={t.key===active?'page':undefined} className={t.key===active?'bt-tab bt-active':'bt-tab'}>{t.label}</Link>)}</nav>
 </div></div>;
}
