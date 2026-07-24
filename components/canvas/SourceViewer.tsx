"use client";

import { useEffect, useState } from "react";
import { ExternalLink, AlertCircle } from "lucide-react";
import type { Source } from "@/components/Message";

interface SourcePayload {
  title: string;
  url: string;
  type: string;
  section: string | null;
  content: string;
  parts: number;
}

/**
 * Renders a cited source's full content inline in the canvas, reassembled
 * from knowledge_chunks — no round-trip to Notion or oregon.public.law.
 */
export function SourceViewer({ source }: { source: Source }) {
  const [data, setData] = useState<SourcePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/knowledge/source?url=${encodeURIComponent(source.url)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((payload: SourcePayload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this source from the knowledge base.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source.url]);

  const externalLabel =
    source.type === "notion_sop"
      ? "Open in Notion"
      : source.type === "ors_90"
        ? "Open at oregon.public.law"
        : "Open source";

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-terra-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl px-8 py-16 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-charcoal-300" />
        <p className="text-sm text-charcoal-600">{error ?? "Source not found."}</p>
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-charcoal-900 px-3 py-2 text-xs font-medium text-white hover:bg-charcoal-800"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {externalLabel}
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold leading-snug text-charcoal-900">
            <span className="mr-2">{source.icon}</span>
            {data.title}
          </h1>
          {data.section && (
            <p className="mt-1 text-sm text-charcoal-400">
              {data.type === "ors_90" ? `ORS ${data.section}` : data.section}
            </p>
          )}
        </div>
        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-charcoal-900 px-3 py-2 text-xs font-medium text-white hover:bg-charcoal-800"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {externalLabel}
        </a>
      </div>

      <div className="rounded-xl border border-sand-200 bg-white p-6 shadow-card">
        {data.content.split(/\n\n+/).map((para, i) => (
          <p
            key={i}
            className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-charcoal-700 last:mb-0"
          >
            {para}
          </p>
        ))}
      </div>

      <p className="mt-3 text-2xs text-charcoal-400">
        Reconstructed from the HDPM knowledge base — the linked original is the
        source of truth.
      </p>
    </div>
  );
}
