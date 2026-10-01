'use client';
import {Bar,BarChart,ResponsiveContainer,ReferenceLine,Tooltip,XAxis} from 'recharts';
import {FOCUS_CAP,GATE} from '@/lib/agents/chase-board';

function Ring({done,total}:{done:number;total:number}) {
 const pct=total?done/total:1,r=26,c=2*Math.PI*r;
 return <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0" role="img" aria-label={`${done} of ${total} cleared today`}>
  <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-sand-100"/>
  <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-green-700 transition-all" strokeDasharray={`${pct*c} ${c}`} transform="rotate(-90 32 32)"/>
  <text x="32" y="37" textAnchor="middle" className="fill-charcoal-900 text-[15px] font-semibold">{done}/{total}</text>
 </svg>;
}

/** Today's progress, this week's sends against the Loop 1 gate, and the 8-week trend. */
export default function FocusStrip({cleared,remaining,weeks,daysToGate}:{cleared:number;remaining:number;weeks:{week:string;sends:number}[];daysToGate:number}) {
 const total=Math.min(FOCUS_CAP,cleared+remaining),thisWeek=weeks[weeks.length-1]?.sends||0,met=thisWeek>=GATE.sendsPerWeek;
 return <div className="grid gap-3 sm:grid-cols-3">
  <div className="flex items-center gap-4 rounded-xl border border-sand-200 bg-white p-4"><Ring done={Math.min(cleared,total)} total={total}/><div><p className="text-xs uppercase tracking-wide text-charcoal-500">Today</p><p className="text-sm font-medium">{remaining?`${remaining} in focus`:'Focus list clear'}</p><p className="text-xs text-charcoal-500">Capped at {FOCUS_CAP}. Finish these first.</p></div></div>
  <div className="rounded-xl border border-sand-200 bg-white p-4"><p className="text-xs uppercase tracking-wide text-charcoal-500">Follow-ups sent this week</p><p className="mt-1 text-3xl font-semibold tabular-nums">{thisWeek}<span className="text-base font-normal text-charcoal-400"> / {GATE.sendsPerWeek}</span></p>
   <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sand-100"><div className={`h-full ${met?'bg-green-700':'bg-amber-400'}`} style={{width:`${Math.min(100,thisWeek/GATE.sendsPerWeek*100)}%`}}/></div>
   <p className="mt-1 text-xs text-charcoal-500">{daysToGate>0?`Gate review in ${daysToGate} day${daysToGate===1?'':'s'} (Oct 15)`:daysToGate===0?'Gate review today':'Gate review date passed'}</p></div>
  <div className="rounded-xl border border-sand-200 bg-white p-4"><p className="text-xs uppercase tracking-wide text-charcoal-500">Last 8 weeks</p>
   <div className="h-16"><ResponsiveContainer width="100%" height="100%"><BarChart data={weeks} margin={{top:4,right:0,bottom:0,left:0}}><XAxis dataKey="week" hide/><Tooltip cursor={false} formatter={(v)=>[`${v} sent`,'']} labelFormatter={(w)=>`Week of ${w}`}/><ReferenceLine y={GATE.sendsPerWeek} stroke="#a3a3a3" strokeDasharray="3 3"/><Bar dataKey="sends" fill="#15803d" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div>
   <p className="text-xs text-charcoal-500">Dashed line: gate ({GATE.sendsPerWeek}/week)</p></div>
 </div>;
}
