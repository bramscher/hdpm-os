"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { ChatWindow } from "@/components/ChatWindow";
import { HelpButton } from "@/components/HelpButton";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const [isChatOpen, setIsChatOpen] = useState(false);

  const handleToggleChat = useCallback(() => {
    setIsChatOpen((prev) => !prev);
  }, []);

  // Also listen for the custom event (in case anything still dispatches it)
  useEffect(() => {
    const handler = () => setIsChatOpen(true);
    window.addEventListener("open-chat", handler);
    return () => window.removeEventListener("open-chat", handler);
  }, []);

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen page-texture">
      <Sidebar
        collapsed={isChatOpen}
        onToggleChat={handleToggleChat}
        isChatOpen={isChatOpen}
      />

      {/* Page content */}
      <main
        className={cn(
          "min-h-screen transition-all duration-300 ease-in-out",
          isChatOpen ? "ml-[64px]" : "ml-[220px]"
        )}
      >
        <div className={cn(isChatOpen && "hidden")}>
          {children}
        </div>

        {/* Full-page chat */}
        {isChatOpen && (
          <ChatWindow
            isOpen={true}
            onClose={() => setIsChatOpen(false)}
            onMinimize={() => setIsChatOpen(false)}
          />
        )}
      </main>

      {/* Per-page help → Notion SOP */}
      {!isChatOpen && <HelpButton />}
    </div>
  );
}
