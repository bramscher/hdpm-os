"use client";

import { Suspense } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import BoardClient from "@/app/maintenance/board/board-client";
import "@/app/maintenance/board/maintenance-theme.css";
import { InspectionDashboard } from "@/app/maintenance/inspections/inspection-dashboard";
import { CandidatesView } from "@/app/maintenance/inspections/candidates/candidates-table";
import { APP_EMBEDS, type AppEmbedKey } from "@/lib/canvas-routes";

/** Placeholder for views not yet embedded — links out to the full page. */
function LinkCard({ appKey }: { appKey: AppEmbedKey }) {
  const cfg = APP_EMBEDS[appKey];
  return (
    <div className="mx-auto max-w-md px-8 py-16 text-center">
      <p className="text-sm text-charcoal-500">
        {cfg.title} doesn&apos;t embed in the canvas yet.
      </p>
      <Link
        href={cfg.route}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-charcoal-900 px-4 py-2 text-sm font-medium text-white hover:bg-charcoal-800"
      >
        Open {cfg.title}
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/** Renders an app view inside the canvas pane. */
export function AppEmbed({ appKey }: { appKey: AppEmbedKey }) {
  switch (appKey) {
    case "board":
      return (
        <div className="h-full overflow-auto">
          <Suspense fallback={null}>
            <BoardClient embedded initialView="dashboard" />
          </Suspense>
        </div>
      );
    case "inspections":
      return (
        <div className="h-full overflow-auto">
          <div className="container mx-auto px-4 py-6">
            <InspectionDashboard />
          </div>
        </div>
      );
    case "candidates":
      return (
        <div className="h-full overflow-auto">
          <div className="container mx-auto px-4 py-6">
            <CandidatesView />
          </div>
        </div>
      );
    default:
      return <LinkCard appKey={appKey} />;
  }
}
