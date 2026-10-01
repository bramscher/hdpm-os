'use client';
import type {FollowupCandidate,FollowupReview} from '@/lib/agents/estimate-followups';
import {daysStuck,heatFor,isLocked,nextStep,type Heat,type StepKind} from '@/lib/agents/chase-board';

const HEAT:Record<Heat,{bar:string;text:string;label:string}>={
 fresh:{bar:'bg-emerald-500',text:'text-emerald-700',label:'under a week'},
 warm:{bar:'bg-amber-400',text:'text-amber-700',label:'1–3 weeks'},
 hot:{bar:'bg-red-500',text:'text-red-700',label:'3+ weeks'},
 escalate:{bar:'bg-purple-600',text:'text-purple-700',label:'45+ days — escalate'},
};
export const STEP:Record<StepKind,{dot:string;text:string;label:string}>={
 check:{dot:'bg-red-600',text:'text-red-800',label:'Check'},
 fix:{dot:'bg-amber-500',text:'text-amber-900',label:'Fix first'},
 decide:{dot:'bg-purple-600',text:'text-purple-900',label:'Decide'},
 chase:{dot:'bg-green-700',text:'text-green-900',label:'Chase'},
 wait:{dot:'bg-charcoal-300',text:'text-charcoal-600',label:'Waiting'},
};
/** Fill shows days stuck against the 45-day escalation line. */
export function HeatBar({days}:{days:number}) {
 const h=HEAT[heatFor(days)];
 return <span className="inline-flex h-1.5 w-16 overflow-hidden rounded-full bg-sand-100" title={`${days} days in status (${h.label})`}><span className={`${h.bar} h-full`} style={{width:`${Math.min(100,Math.max(8,days/45*100))}%`}}/></span>;
}
/** Chases so far out of the three before escalation. */
export function ChaseDots({count}:{count:number}) {
 return <span className="inline-flex items-center gap-0.5" title={`${count} follow-up${count===1?'':'s'} sent`} aria-label={`${count} of 3 follow-ups sent`}>{[0,1,2].map(i=><span key={i} className={`h-2 w-2 rounded-full ${i<count?'bg-charcoal-800':'border border-charcoal-300'}`}/>)}{count>3&&<span className="ml-0.5 text-[10px] text-charcoal-500">+{count-3}</span>}</span>;
}

export default function ChaseCard({c,r,chases,onOpen,showLane}:{c:FollowupCandidate;r?:FollowupReview;chases:number;onOpen:()=>void;showLane?:string}) {
 const days=daysStuck(c),h=HEAT[heatFor(days)];
 const step=nextStep(c,r),st=STEP[step.kind];
 const flag=isLocked(r)?'Check delivery':c.newEpisode?'Changed':c.priority==='P1'?'P1':'';
 return <button onClick={onOpen} className="group w-full rounded-lg border border-sand-200 bg-white p-3 text-left transition hover:border-charcoal-400 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700">
  <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-semibold">{c.property}{c.unit&&` · ${c.unit}`}</span><span className={`shrink-0 text-xs font-semibold tabular-nums ${h.text}`}>{days}d</span></div>
  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-charcoal-500"><span className="truncate">WO {c.woNumber||'—'} · {c.vendor||'No vendor'}</span>{flag&&<span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${flag==='Check delivery'||flag==='P1'?'bg-red-50 text-red-700':'bg-amber-50 text-amber-800'}`}>{flag}</span>}</div>
  <p className={`mt-2 flex items-start gap-1.5 text-xs font-medium leading-snug ${st.text}`}><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} aria-hidden/><span><span className="sr-only">{st.label}: </span>{step.text}</span></p>
  <div className="mt-2 flex items-center justify-between gap-2"><HeatBar days={days}/>{showLane&&<span className="truncate text-[11px] text-charcoal-500">{showLane}</span>}<ChaseDots count={chases}/></div>
 </button>;
}
