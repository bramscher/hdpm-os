"use client";

import { createContext, useContext } from "react";
import type { Source } from "@/components/Message";
import type { AppEmbedKey } from "@/lib/canvas-routes";

/**
 * What the canvas (right pane of the agent interface) is showing.
 * 'data' cards arrive in a later phase (chat tool-use).
 */
export type CanvasState =
  | { mode: "dashboard" }
  | { mode: "source"; source: Source }
  | { mode: "app"; appKey: AppEmbedKey };

export const CanvasContext = createContext<{
  state: CanvasState;
  setState: (s: CanvasState) => void;
}>({ state: { mode: "dashboard" }, setState: () => {} });

export function useCanvas() {
  return useContext(CanvasContext);
}
