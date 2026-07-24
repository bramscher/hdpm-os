"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { HelpButton } from "@/components/HelpButton";

/**
 * App chrome: fixed sidebar + page content. The Knowledge Chat lives on the
 * home page as a persistent panel (the agent interface), so the old full-page
 * chat overlay is gone — the sidebar chat button simply navigates home.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";

  // Legacy hook: anything dispatching "open-chat" now lands on the agent page.
  useEffect(() => {
    const handler = () => router.push("/");
    window.addEventListener("open-chat", handler);
    return () => window.removeEventListener("open-chat", handler);
  }, [router]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen page-texture">
      <Sidebar
        collapsed={false}
        onToggleChat={() => router.push("/")}
        isChatOpen={pathname === "/"}
      />

      {/* Page content */}
      <main className="min-h-screen ml-[220px]">{children}</main>

      {/* Per-page help → Notion SOP */}
      <HelpButton />
    </div>
  );
}
