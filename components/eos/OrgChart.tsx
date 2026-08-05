import { Bot, Target, User } from 'lucide-react';
import { SEAT_AGENTS, type SeatNode } from '@/lib/eos/org';
import type { Rock, ScorecardMetric } from '@/lib/eos/types';
import { cn } from '@/lib/utils';

/**
 * Read-only accountability chart (Brief 2E, doc 06 §3). Server-rendered —
 * no interactivity by design; seats change in quarterly conversations,
 * not by drag-and-drop. Agents render under seats, never as seats.
 */
interface Props {
  tree: SeatNode[];
  metricsByPerson: Map<string, ScorecardMetric[]>;
  rocksByPerson: Map<string, Rock[]>;
}

function SeatCard({
  node,
  metricsByPerson,
  rocksByPerson,
  depth,
}: {
  node: SeatNode;
  metricsByPerson: Props['metricsByPerson'];
  rocksByPerson: Props['rocksByPerson'];
  depth: number;
}) {
  const { seat } = node;
  const metrics = seat.person ? (metricsByPerson.get(seat.person) ?? []) : [];
  const rocks = seat.person ? (rocksByPerson.get(seat.person) ?? []) : [];
  const agents = SEAT_AGENTS[seat.name] ?? [];

  return (
    <div className={cn(depth > 0 && 'border-l-2 border-sand-200 pl-4', 'mt-3')}>
      <div className="rounded-xl border border-sand-200 bg-white shadow-card p-3">
        <div className="flex items-center gap-2">
          <User size={14} className="text-charcoal-400" aria-hidden />
          <span className="text-sm font-semibold text-charcoal-900">{seat.name}</span>
          {seat.person ? (
            <span className="text-sm text-charcoal-600">— {seat.person}</span>
          ) : (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">OPEN</span>
          )}
        </div>
        {seat.roles.length > 0 ? (
          <ul className="mt-1.5 text-xs text-charcoal-500">
            {seat.roles.map((role) => (
              <li key={role} className="ml-4 list-disc">
                {role}
              </li>
            ))}
          </ul>
        ) : null}
        {metrics.length > 0 ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-charcoal-500">
            <Target size={12} className="text-charcoal-400" aria-hidden />
            {metrics.map((m) => (
              <span key={m.id} className="rounded bg-sand-100 px-1.5 py-0.5">
                {m.name}
              </span>
            ))}
          </p>
        ) : null}
        {rocks.length > 0 ? (
          <div className="mt-1.5 space-y-0.5">
            {rocks.map((r) => (
              <p key={r.id} className="text-xs text-charcoal-600">
                🪨 {r.title}{' '}
                <span
                  className={cn(
                    'rounded-full px-1.5',
                    r.status === 'on'
                      ? 'bg-green-50 text-green-800'
                      : r.status === 'off'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-sand-100 text-charcoal-500'
                  )}
                >
                  {r.status}
                </span>
              </p>
            ))}
          </div>
        ) : null}
        {agents.length > 0 ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
            <Bot size={12} className="text-charcoal-400" aria-hidden />
            {agents.map((a) => (
              <span key={a} className="rounded-full bg-blue-50 px-1.5 py-0.5 text-blue-700">
                {a}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      {node.children.map((child) => (
        <SeatCard
          key={child.seat.id}
          node={child}
          metricsByPerson={metricsByPerson}
          rocksByPerson={rocksByPerson}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export default function OrgChart({ tree, metricsByPerson, rocksByPerson }: Props) {
  return (
    <div>
      {tree.map((node) => (
        <SeatCard
          key={node.seat.id}
          node={node}
          metricsByPerson={metricsByPerson}
          rocksByPerson={rocksByPerson}
          depth={0}
        />
      ))}
    </div>
  );
}
