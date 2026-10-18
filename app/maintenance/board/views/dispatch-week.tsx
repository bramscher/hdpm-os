'use client';

/**
 * Dispatch week strip: Alberto, Brody and a Vendors row across Mon–Sun. Drop a
 * card on a tech's day to add it to that day's draft (Brody publishes it from the
 * Route Builder); drop it on the Vendors row to give its vendor a date. Drag a
 * chip to another day to move it, or onto "Take off the schedule".
 */

import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { MaintWorkOrder } from '@/lib/maintenance/types';
import { DISPATCH_TECHS, weekDays, type TechDay } from '@/lib/maintenance/dispatch';
import { fmtDate, todayStr } from '../board-types';

/** A tech's day is about 8 hours on site. */
const DAY_MINUTES = 8 * 60;

export type WeekRowKey = string; // 'tech:Alberto' | 'vendor'

export interface VendorDay {
  wo: MaintWorkOrder;
  date: string;
  vendorName: string;
  /** Only AppFolio has this date (no board date yet). */
  fromAppFolio: boolean;
}

export const dayDropId = (row: WeekRowKey, date: string) => `day|${row}|${date}`;
export const chipDragId = (row: WeekRowKey, date: string, woId: string) => `chip|${row}|${date}|${woId}`;
export const UNSCHEDULE_ID = 'unschedule';

export function parseDayDrop(id: string): { row: WeekRowKey; date: string } | null {
  const [kind, row, date] = id.split('|');
  return kind === 'day' && row && date ? { row, date } : null;
}

export function parseChipDrag(id: string): { row: WeekRowKey; date: string; woId: string } | null {
  const [kind, row, date, woId] = id.split('|');
  return kind === 'chip' && row && date && woId ? { row, date, woId } : null;
}

const weekday = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
const hours = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`);

export default function DispatchWeek({
  monday,
  onWeek,
  open,
  onToggle,
  techDays,
  vendorDays,
  woById,
  loading,
}: {
  monday: string;
  onWeek: (delta: number | 'this') => void;
  open: boolean;
  onToggle: () => void;
  techDays: TechDay[];
  vendorDays: VendorDay[];
  woById: Map<string, MaintWorkOrder>;
  loading: boolean;
}) {
  const days = weekDays(monday);
  const today = todayStr();
  const scheduled = techDays.reduce((n, d) => n + d.work_order_ids.length, 0) + vendorDays.length;

  return (
    <section className="dweek">
      <header className="dweek-head">
        <button className="dcol-toggle" onClick={onToggle} aria-expanded={open}>
          {open ? '▾' : '▸'}
        </button>
        <b>Week of {fmtDate(monday)}</b>
        <span className="dweek-count">{loading ? 'loading…' : `${scheduled} scheduled`}</span>
        <span className="dweek-nav">
          <button className="mo-btn secondary" onClick={() => onWeek(-1)} aria-label="Previous week">‹</button>
          <button className="mo-btn secondary" onClick={() => onWeek('this')}>This week</button>
          <button className="mo-btn secondary" onClick={() => onWeek(1)} aria-label="Next week">›</button>
        </span>
        {open && <UnscheduleZone />}
      </header>
      {open && (
        <div className="dweek-scroll">
          <div className="dweek-grid">
            <div />
            {days.map((d) => (
              <div key={d} className={`dweek-day${d === today ? ' today' : ''}`}>
                {weekday(d)} {fmtDate(d)}
              </div>
            ))}
            {DISPATCH_TECHS.map((tech) => (
              <TechRow key={tech} tech={tech} days={days} techDays={techDays} woById={woById} />
            ))}
            <div className="dweek-label">Vendors</div>
            {days.map((d) => (
              <DayCell key={d} row="vendor" date={d}>
                {vendorDays
                  .filter((v) => v.date === d)
                  .map((v) => (
                    <Chip
                      key={v.wo.id}
                      id={chipDragId('vendor', d, v.wo.id)}
                      wo={v.wo}
                      sub={v.vendorName}
                      tone={v.fromAppFolio ? 'appfolio' : undefined}
                      title={v.fromAppFolio ? 'Date from AppFolio' : 'Date planned on the board'}
                    />
                  ))}
              </DayCell>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TechRow({ tech, days, techDays, woById }: { tech: string; days: string[]; techDays: TechDay[]; woById: Map<string, MaintWorkOrder> }) {
  const row = `tech:${tech}`;
  return (
    <>
      <div className="dweek-label">{tech}</div>
      {days.map((d) => {
        const day = techDays.find((t) => t.date === d && t.tech.toLowerCase() === tech.toLowerCase());
        const published = day?.status === 'published';
        const over = (day?.service_minutes ?? 0) > DAY_MINUTES;
        return (
          <DayCell key={d} row={row} date={d} published={published}>
            {day && (
              <span className={`dweek-cap${over ? ' over' : ''}`}>
                {published ? '✓ published · ' : 'draft · '}
                {day.work_order_ids.length} · {hours(day.service_minutes)}
              </span>
            )}
            {day?.work_order_ids.map((id) => {
              const wo = woById.get(id);
              return wo ? (
                <Chip key={id} id={chipDragId(row, d, id)} wo={wo} disabled={published} title={published ? 'Published. Change it in Route Builder.' : 'Draft stop'} />
              ) : null;
            })}
          </DayCell>
        );
      })}
    </>
  );
}

function DayCell({ row, date, published, children }: { row: WeekRowKey; date: string; published?: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(row, date) });
  const past = date < todayStr();
  return (
    <div
      ref={setNodeRef}
      className={`dweek-cell${isOver ? (published || past ? ' refuse' : ' over') : ''}${published ? ' published' : ''}${past ? ' past' : ''}`}
    >
      {children}
    </div>
  );
}

function Chip({ id, wo, sub, tone, disabled, title }: { id: string; wo: MaintWorkOrder; sub?: string; tone?: 'appfolio'; disabled?: boolean; title?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  const edge = (wo.priority_class ?? 'p4').toLowerCase();
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`wchip ${edge}${tone ? ` ${tone}` : ''}${isDragging ? ' ghost' : ''}${disabled ? ' locked' : ''}`}
      title={`${title ? `${title}. ` : ''}${wo.description}`}
    >
      <span className="wonum">#{wo.wo_number ?? '—'}</span> {wo.property_name}
      {sub && <span className="wsub">{sub}</span>}
    </div>
  );
}

function UnscheduleZone() {
  const { setNodeRef, isOver } = useDroppable({ id: UNSCHEDULE_ID });
  return (
    <span ref={setNodeRef} className={`dweek-off${isOver ? ' over' : ''}`}>
      Drop here to take off the schedule
    </span>
  );
}
