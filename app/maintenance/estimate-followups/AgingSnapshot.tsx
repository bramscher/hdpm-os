'use client';
import {STEP_ORDER,type AgeBucket,type Lane,type SnapshotFilter,type StepKind,type agingSnapshot} from '@/lib/agents/chase-board';
import {STEP} from './ChaseCard';

type Snapshot=ReturnType<typeof agingSnapshot>;
const STEP_HELP:Record<StepKind,string>={fix:'Can’t be chased yet: no vendor, no contact, or no recorded decider',decide:'Over 90 days with no date: close it or set a date',chase:'Ready: send the follow-up',check:'A message may not have gone out',wait:'Waiting on team help'};

/** One-hue sequential shade by share of the busiest cell; text flips to white on the dark steps. */
function shade(count:number,max:number) {
 if(!count)return 'bg-sand-50 text-charcoal-300';
 const t=count/max;
 return t>0.75?'bg-green-800 text-white':t>0.5?'bg-green-700 text-white':t>0.3?'bg-green-500 text-white':t>0.15?'bg-green-200 text-charcoal-900':'bg-green-100 text-charcoal-900';
}

/** Where the stuck work is (stage × age) and what it needs next, in one glance. Click to filter the board. */
export default function AgingSnapshot({snap,filter,onFilter}:{snap:Snapshot;filter:SnapshotFilter;onFilter:(f:SnapshotFilter)=>void}) {
 const cleanup=snap.steps.fix+snap.steps.decide,old=snap.columns.slice(3).reduce((n,c)=>n+c.total,0);
 const pick=(f:SnapshotFilter)=>onFilter(JSON.stringify(f)===JSON.stringify(filter)?{}:f);
 const on=(lane?:Lane,age?:AgeBucket)=>filter.lane===lane&&filter.age===age&&!filter.step;
 return <section aria-labelledby="snapshot-heading" className="rounded-xl border border-sand-200 bg-white p-4 sm:p-5">
  <h3 id="snapshot-heading" className="text-lg font-semibold leading-snug">{snap.total} work orders are stuck. <span className="text-charcoal-500">{cleanup} need cleanup before anyone can chase them, and {old} have been stuck over 45 days.</span></h3>

  <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
   <div className="overflow-x-auto">
    <table className="w-full min-w-[480px] border-separate border-spacing-0.5 text-sm">
     <caption className="mb-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500">How long it’s been stuck, by stage</caption>
     <thead><tr><th className="w-36"/>{snap.columns.map(c=><th key={c.key} scope="col" className="pb-1 text-center text-xs font-medium text-charcoal-500">{c.label}</th>)}<th scope="col" className="pb-1 text-right text-xs font-medium text-charcoal-500">Total</th></tr></thead>
     <tbody>{snap.rows.map(r=><tr key={r.key}>
      <th scope="row" className="pr-2 text-left"><button className={`text-left text-sm font-medium hover:underline ${on(r.key)?'underline':''}`} onClick={()=>pick({lane:r.key})}>{r.label}</button></th>
      {r.cells.map(cell=>{
       const sel=on(r.key,cell.key),parts=STEP_ORDER.filter(k=>cell.steps[k]).map(k=>`${cell.steps[k]} ${STEP[k].label.toLowerCase()}`).join(', ');
       return <td key={cell.key} className="p-0">
        <button disabled={!cell.count} onClick={()=>pick({lane:r.key,age:cell.key})} aria-pressed={sel} aria-label={`${r.label}, ${cell.label}: ${cell.count}${parts?` (${parts})`:''}`}
         className={`group relative flex h-14 w-full items-center justify-center rounded-md text-lg font-semibold tabular-nums transition ${shade(cell.count,snap.max)} ${sel?'ring-2 ring-charcoal-900 ring-offset-1':''} ${cell.count?'hover:ring-2 hover:ring-charcoal-400':''}`}>
         {cell.count||'·'}
         {cell.count>0&&<span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-48 -translate-x-1/2 rounded-lg bg-charcoal-900 p-2.5 text-left text-xs font-normal text-white shadow-lg group-hover:block group-focus-visible:block">
          <span className="block font-semibold">{cell.count} · {r.label}, {cell.label}{cell.key==='d7'?'':' days'}</span>
          {STEP_ORDER.filter(k=>cell.steps[k]).map(k=><span key={k} className="mt-1 flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STEP[k].dot}`}/>{cell.steps[k]} {STEP[k].label.toLowerCase()}</span>)}
          <span className="mt-1.5 block text-white/60">Click to show these cards</span>
         </span>}
        </button>
       </td>;
      })}
      <td className="pl-2 text-right font-semibold tabular-nums">{r.total}</td>
     </tr>)}</tbody>
     <tfoot><tr><th scope="row" className="pt-1 text-left text-xs font-medium text-charcoal-500">All stages</th>{snap.columns.map(c=><td key={c.key} className="pt-1"><button className={`w-full text-center text-xs font-semibold tabular-nums hover:underline ${filter.age===c.key&&!filter.lane?'underline':''}`} onClick={()=>pick({age:c.key})}>{c.total}</button></td>)}<td className="pt-1 pl-2 text-right text-xs font-semibold tabular-nums">{snap.total}</td></tr></tfoot>
    </table>
    <p className="mt-2 text-xs text-charcoal-500">Darker = more work orders. Click a cell, a stage, or a column total to see those cards.</p>
   </div>

   <div>
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">What they need next</p>
    <div className="flex h-9 w-full gap-0.5 overflow-hidden rounded-md" role="group" aria-label="Work orders by next step">
     {STEP_ORDER.filter(k=>snap.steps[k]).map(k=><button key={k} onClick={()=>pick({step:k})} aria-pressed={filter.step===k} title={`${snap.steps[k]} ${STEP[k].label.toLowerCase()}: ${STEP_HELP[k]}`}
      className={`${STEP[k].dot} h-full min-w-[6px] transition hover:opacity-80 ${filter.step&&filter.step!==k?'opacity-30':''}`} style={{flexGrow:snap.steps[k]}}/>)}
    </div>
    <ul className="mt-3 space-y-1.5">{STEP_ORDER.filter(k=>snap.steps[k]).map(k=><li key={k}>
     <button onClick={()=>pick({step:k})} aria-pressed={filter.step===k} className={`flex w-full items-start gap-2 rounded-md p-1.5 text-left hover:bg-sand-50 ${filter.step===k?'bg-sand-100':''}`}>
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ${STEP[k].dot}`}/>
      <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">{snap.steps[k]}</span>
      <span className="text-sm"><span className="font-medium">{STEP[k].label}</span><span className="text-charcoal-500"> · {STEP_HELP[k]}</span></span>
     </button>
    </li>)}</ul>
   </div>
  </div>
 </section>;
}
