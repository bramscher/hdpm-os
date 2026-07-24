"use client";

import { useEffect } from "react";
import { Home, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { APP_EMBEDS } from "@/lib/canvas-routes";
import type { CanvasState } from "./types";
import { DashboardCanvas } from "./DashboardCanvas";
import { SourceViewer } from "./SourceViewer";
import { AppEmbed } from "./AppEmbed";

/**
 * The right pane of the agent interface: shows the tile dashboard by default,
 * and swaps to a cited source or an embedded app view when the chat steers it.
 */
export function Canvas({
  state,
  onBackToDashboard,
}: {
  state: CanvasState;
  onBackToDashboard: () => void;
}) {
  useEffect(() => {
    if (state.mode === "dashboard") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBackToDashboard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.mode, onBackToDashboard]);

  const title =
    state.mode === "source"
      ? state.source.title
      : state.mode === "app"
        ? APP_EMBEDS[state.appKey].title
        : "";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-sand-50">
      {state.mode !== "dashboard" && (
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-sand-200 bg-white px-4">
          <button
            onClick={onBackToDashboard}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-charcoal-500 transition-colors hover:bg-sand-100 hover:text-charcoal-800"
            title="Back to dashboard (Esc)"
          >
            <Home className="h-3.5 w-3.5" />
            Dashboard
          </button>
          <span className="min-w-0 truncate text-sm font-semibold text-charcoal-900">
            {title}
          </span>
          {state.mode === "app" && (
            <Link
              href={APP_EMBEDS[state.appKey].route}
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-charcoal-400 hover:text-charcoal-700"
            >
              Open full page
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.mode === "dashboard" && <DashboardCanvas />}
        {state.mode === "source" && <SourceViewer source={state.source} />}
        {state.mode === "app" && <AppEmbed appKey={state.appKey} />}
      </div>
    </div>
  );
}
