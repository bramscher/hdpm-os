"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ExternalLink, ListTodo } from "lucide-react";
import { BUCKET_LABEL, BUCKET_ORDER, type Activity, type Bucket } from "@/lib/activities";
import { cn } from "@/lib/utils";

interface Payload {
  matchedStaff: boolean;
  today: string;
  counts: Record<Bucket, number>;
  buckets: Record<Bucket, Activity[]>;
}

const TONE: Record<Bucket, string> = {
  overdue: "border-red-200 bg-red-50 text-red-800",
  today: "border-amber-200 bg-amber-50 text-amber-800",
  next7: "border-sand-200 bg-white text-charcoal-800",
  later: "border-sand-200 bg-white text-charcoal-500",
};

const PREVIEW = 5;

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/**
 * "My AppFolio activities" on the home dashboard: the signed-in person's
 * pending activities from AppFolio (same /api/activities feed as the
 * Activities page), with the most urgent few listed. Hidden when the
 * Activities section is switched off for this person.
 */
export function MyActivitiesCard() {
  const { data: session, status } = useSession();
  const denied = (session?.user?.deniedSections ?? []).includes("activities");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || denied) return;
    let live = true;
    fetch("/api/activities")
      .then(async (r) => {
        if (r.status === 503) {
          if (live) setUnavailable(true);
          return;
        }
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (live) setData(j as Payload);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [status, denied]);

  if (denied || unavailable || status !== "authenticated") return null;

  const urgent = data ? [...data.buckets.overdue, ...data.buckets.today, ...data.buckets.next7].slice(0, PREVIEW) : [];
  const total = data ? BUCKET_ORDER.reduce((n, b) => n + data.counts[b], 0) : 0;

  return (
    <section aria-labelledby="my-activities-title" className="mb-6 rounded-lg border border-sand-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ListTodo className="h-4 w-4 text-charcoal-950" />
          <div>
            <p className="text-[11px] font-medium text-charcoal-400">From AppFolio</p>
            <h2 id="my-activities-title" className="text-sm font-semibold text-charcoal-950">
              My activities{data && data.matchedStaff ? ` · ${total} pending` : ""}
            </h2>
          </div>
        </div>
        <Link href="/activities" className="text-xs font-medium text-charcoal-400 hover:text-charcoal-600">
          See all →
        </Link>
      </div>

      {error && <p className="text-sm text-red-700">Couldn’t load your AppFolio activities: {error}</p>}
      {!data && !error && <div className="h-16 animate-pulse rounded-md bg-sand-100" aria-label="Loading activities" />}

      {data && !data.matchedStaff && (
        <p className="text-sm text-charcoal-500">
          We couldn’t match your account to an AppFolio user, so no activities are shown. Your name in the staff directory
          needs to match your AppFolio user name. Ask an admin to check it.
        </p>
      )}

      {data && data.matchedStaff && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BUCKET_ORDER.map((b) => (
              <Link key={b} href={`/activities#${b}`} className={cn("rounded-md border px-3 py-2", TONE[b])}>
                <div className="text-lg font-semibold tabular-nums">{data.counts[b]}</div>
                <div className="text-[11px] font-medium">{BUCKET_LABEL[b]}</div>
              </Link>
            ))}
          </div>
          {urgent.length > 0 ? (
            <ul className="mt-3 divide-y divide-sand-100">
              {urgent.map((a, i) => (
                <li key={`${a.date}-${i}`} className="flex items-start gap-3 py-2 text-sm">
                  <span className={cn("w-14 shrink-0 text-xs font-medium", a.date < data.today ? "text-red-700" : "text-charcoal-500")}>
                    {shortDate(a.date)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-charcoal-900">{a.activity}</span>
                    <span className="block truncate text-xs text-charcoal-500">
                      {[a.activityFor, a.unitAddress ?? a.propertyName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {a.link && (
                    <a
                      href={a.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-terra-700 hover:underline"
                    >
                      AppFolio <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-charcoal-500">Nothing due in the next 7 days.</p>
          )}
        </>
      )}
    </section>
  );
}
