"use client";

import { useCallback, useState } from "react";
import { MessageCircle } from "lucide-react";
import { ChatWindow } from "@/components/ChatWindow";
import { Canvas } from "@/components/canvas/Canvas";
import { CanvasContext, type CanvasState } from "@/components/canvas/types";
import type { Source } from "@/components/Message";
import type { AppEmbedKey } from "@/lib/canvas-routes";
import { cn } from "@/lib/utils";

/**
 * The agent interface: HDPM Knowledge Chat as a persistent left panel and a
 * contextual canvas on the right. The canvas rests on the tile dashboard and
 * swaps to cited sources or embedded app views as the conversation steers it.
 * Below lg the canvas is full-width and the chat opens from a FAB.
 */
export default function Home() {
  const [canvas, setCanvas] = useState<CanvasState>({ mode: "dashboard" });
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const handleOpenSource = useCallback((source: Source) => {
    setCanvas({ mode: "source", source });
    setMobileChatOpen(false); // reveal the canvas on mobile
  }, []);

  const handleOpenApp = useCallback((appKey: AppEmbedKey) => {
    setCanvas({ mode: "app", appKey });
    setMobileChatOpen(false);
  }, []);

  return (
    <CanvasContext.Provider value={{ state: canvas, setState: setCanvas }}>
      <div className="flex h-screen overflow-hidden">
        {/* Chat panel — persistent ≥lg, full-screen overlay below lg */}
        <div
          className={cn(
            "shrink-0 border-r border-sand-200 bg-white",
            "lg:static lg:z-auto lg:flex lg:w-[380px] xl:w-[420px] 2xl:w-[480px]",
            mobileChatOpen ? "fixed inset-0 z-40 flex w-full" : "hidden"
          )}
        >
          <ChatWindow
            isOpen
            variant="panel"
            onOpenSource={handleOpenSource}
            onOpenApp={handleOpenApp}
            onClose={() => setMobileChatOpen(false)}
            onMinimize={() => setMobileChatOpen(false)}
          />
        </div>

        {/* Canvas */}
        <div className="min-w-0 flex-1">
          <Canvas
            state={canvas}
            onBackToDashboard={() => setCanvas({ mode: "dashboard" })}
          />
        </div>

        {/* Mobile chat FAB (bottom-left; HelpButton owns bottom-right) */}
        <button
          onClick={() => setMobileChatOpen(true)}
          aria-label="Open Knowledge Chat"
          className="fixed bottom-5 left-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-charcoal-900 text-white shadow-card-hover lg:hidden"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      </div>
    </CanvasContext.Provider>
  );
}
