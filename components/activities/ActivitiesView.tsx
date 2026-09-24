"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, ListTodo, RefreshCw } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { BUCKET_LABEL, BUCKET_ORDER, type Activity, type Bucket } from "@/lib/activities";

interface ActivitiesResponse {
  viewing: string;
  matchedStaff: boolean;
  today: string;
  fetchedAt: string;
  counts: Record<Bucket, number>;
  buckets: Record<Bucket, Activity[]>;
  isAdmin: boolean;
  people?: Array<{ name: string; count: number; hidden: boolean; staff: boolean }>;
}

const TILE_TONE: Record<Bucket, string> = {
  overdue: "border-red-200 bg-red-50 text-red-800",
  today: "border-amber-200 bg-amber-50 text-amber-800",
  next7: "border-blue-200 bg-blue-50 text-blue-800",
  later: "border-sand-200 bg-sand-50 text-charcoal-700",
};

function formatDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function daysLate(ymd: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / 86_400_000);
}

export function ActivitiesView() {
  const [person, setPerson] = useState<string>("");
  const [data, setData] = useState<ActivitiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (person) params.set("person", person);
      if (refresh) params.set("refresh", "1");
      const res = await fetch(`/api/activities?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load activities");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [person]);

  useEffect(() => {
    load();
  }, [load]);

  const total = data ? BUCKET_ORDER.reduce((n, b) => n + data.counts[b], 0) : 0;

  return (
    <PageContainer>
      <PageHeader
        title="Activities"
        description={
          data
            ? `Pending AppFolio activities for ${data.viewing} · updated ${new Date(data.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
            : "Your pending AppFolio activities, by due date"
        }
        actions={
          <>
            {data?.isAdmin && data.people && (
              <select
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-charcoal-700"
                aria-label="View activities for"
              >
                <option value="">My activities</option>
                {data.people.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                    {p.hidden ? " (deactivated)" : !p.staff && p.name !== "(unassigned)" ? " (no staff match)" : ""} — {p.count}
                  </option>
                ))}
              </select>
            )}
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </>
        }
      />

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : data ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BUCKET_ORDER.map((b) => (
              <a key={b} href={`#${b}`} className={cn("rounded-xl border p-4", TILE_TONE[b])}>
                <div className="text-2xl font-semibold">{data.counts[b]}</div>
                <div className="text-xs font-medium">{BUCKET_LABEL[b]}</div>
              </a>
            ))}
          </div>

          {total === 0 ? (
            <EmptyState
              icon={ListTodo}
              title="No pending activities"
              hint={
                data.matchedStaff
                  ? "Nothing is assigned to you in AppFolio right now."
                  : "We couldn't match your staff record to an AppFolio user name, so no activities are shown."
              }
            />
          ) : (
            <div className="space-y-8">
              {BUCKET_ORDER.filter((b) => data.buckets[b].length > 0).map((b) => (
                <section key={b} id={b}>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-charcoal-500">
                    {BUCKET_LABEL[b]} · {data.buckets[b].length}
                  </h2>
                  <ul className="divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white">
                    {data.buckets[b].map((a, i) => (
                      <li key={`${a.date}-${i}`} className="flex flex-wrap items-start gap-3 p-4">
                        <div className="w-24 shrink-0 text-sm">
                          <div className="font-medium text-charcoal-800">{formatDate(a.date)}</div>
                          {b === "overdue" && (
                            <div className="text-xs text-red-600">{daysLate(a.date, data.today)}d late</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-charcoal-900">{a.activity}</span>
                            {a.label && <Badge tone="neutral" variant="outline">{a.label}</Badge>}
                          </div>
                          <div className="mt-1 text-sm text-charcoal-500">
                            {[a.activityFor, a.unitAddress ?? a.propertyName].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        {a.link && (
                          <a
                            href={a.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-terra-700 hover:underline"
                          >
                            Open in AppFolio <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      ) : null}
    </PageContainer>
  );
}
