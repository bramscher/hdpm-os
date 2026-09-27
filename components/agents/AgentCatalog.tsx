import { AGENT_CATALOG, PLANNED_AGENTS, SCHEDULED_REPORTS, liveStatus, type CatalogAgent, type LiveState } from '@/lib/agents/catalog';
import type { AgentConfigRow } from '@/lib/agents/types';

const BADGE: Record<LiveState, { label: string; cls: string }> = {
  on: { label: 'Running', cls: 'bg-green-100 text-green-800' },
  off: { label: 'Off', cls: 'bg-sand-200 text-charcoal-600' },
  halted: { label: 'Halted', cls: 'bg-red-100 text-red-700' },
  planned: { label: 'Planned', cls: 'bg-sand-100 text-charcoal-500' },
};

function Card({ a, state, reason }: { a: CatalogAgent; state: LiveState; reason?: string }) {
  const badge = BADGE[state];
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-card ${state === 'on' ? 'border-sand-200' : 'border-dashed border-sand-300'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-semibold text-charcoal-900">{a.name}</p>
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
          {state === 'off' && a.status === 'trial' ? 'Trial · off' : badge.label}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-charcoal-700">{a.what}</p>
      <p className="mt-1.5 text-[12.5px] text-charcoal-500">
        <span className="font-semibold text-charcoal-600">Why: </span>
        {a.why}
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-charcoal-400">Helps</dt>
        <dd className="text-charcoal-700">{a.helps}</dd>
        <dt className="text-charcoal-400">Runs</dt>
        <dd className="text-charcoal-700">{a.when}</dd>
        <dt className="text-charcoal-400">Delivers</dt>
        <dd className="text-charcoal-700">{a.output}</dd>
      </dl>
      {(reason || a.note) && (
        <p className="mt-2 border-t border-sand-100 pt-2 text-[11.5px] text-charcoal-500">
          {reason ? <span className="font-medium text-charcoal-600">{reason}. </span> : null}
          {a.note}
        </p>
      )}
    </div>
  );
}

/**
 * "What runs here and why": every agent in plain English with live on/off
 * status, then the scheduled reports, then planned (unbuilt) agents.
 */
export default function AgentCatalog({ config, killed }: { config: AgentConfigRow[]; killed: boolean }) {
  const envOn = (name: string) => {
    const v = process.env[name];
    return !!v && v !== '0' && v.toLowerCase() !== 'false';
  };
  const items = AGENT_CATALOG.map((a) => ({ a, ...liveStatus(a, config, killed, envOn) }));
  const running = items.filter((i) => i.state === 'on');
  const notRunning = items.filter((i) => i.state !== 'on');

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-semibold text-charcoal-900">Agents &amp; automations</h2>
      <p className="mb-4 text-[13px] text-charcoal-500">
        What runs on its own at HDPM, what it does, and who it helps. Staff talk to Dez in Slack; the rest run on a schedule or
        a button and report back.
      </p>

      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-charcoal-500">Running now ({running.length})</p>
      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {running.map((i) => (
          <Card key={i.a.id} a={i.a} state={i.state} reason={i.reason} />
        ))}
      </div>

      {notRunning.length > 0 && (
        <>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-charcoal-500">Built but not running ({notRunning.length})</p>
          <div className="mb-6 grid gap-3 md:grid-cols-2">
            {notRunning.map((i) => (
              <Card key={i.a.id} a={i.a} state={i.state} reason={i.reason} />
            ))}
          </div>
        </>
      )}

      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-charcoal-500">Scheduled reports ({SCHEDULED_REPORTS.length})</p>
      <div className="mb-6 overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card">
        <table className="w-full text-[13px]">
          <thead className="bg-sand-50 text-left text-[11px] uppercase tracking-wide text-charcoal-500">
            <tr>
              <th className="px-3 py-2">Report</th>
              <th className="px-3 py-2">What it does</th>
              <th className="px-3 py-2">For</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Delivers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {SCHEDULED_REPORTS.map((r) => (
              <tr key={r.name} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-charcoal-900">{r.name}</td>
                <td className="px-3 py-2 text-charcoal-700">{r.what}</td>
                <td className="px-3 py-2 text-charcoal-600">{r.helps}</td>
                <td className="whitespace-nowrap px-3 py-2 text-charcoal-600">{r.when}</td>
                <td className="px-3 py-2 text-charcoal-600">{r.output}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rounded-xl border border-dashed border-sand-300 px-4 py-3">
        <summary className="cursor-pointer text-[12.5px] font-semibold text-charcoal-600">
          Planned, not built ({PLANNED_AGENTS.length}): ideas from the original plan, on hold until the estimate chase proves itself
        </summary>
        <ul className="mt-2 grid gap-1 text-[12.5px] text-charcoal-600 md:grid-cols-2">
          {PLANNED_AGENTS.map((p) => (
            <li key={p.key}>
              <b className="text-charcoal-800">{p.name}</b>: {p.what}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
