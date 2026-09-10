"use client";

import { DashboardCanvas } from "@/components/canvas/DashboardCanvas";

/**
 * Home: the tile dashboard. The former in-app Knowledge Chat has been retired —
 * that conversational role now lives in Dez (Slack). The RAG/knowledge backend
 * stays and is shared with Dez.
 */
export default function Home() {
  return (
    <div className="h-screen overflow-y-auto bg-sand-50">
      <DashboardCanvas />
    </div>
  );
}
