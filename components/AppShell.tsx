"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Toaster } from "sonner";
import { Sidebar, MobileNav } from "@/components/Sidebar";
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
  // Referrer portal opts out of the staff chrome (sidebar/help/nav). The admin
  // subtree keeps the staff shell. Referrer pages bring their own layout.
  const isReferrerRoute =
    pathname.startsWith("/partners") && !pathname.startsWith("/partners/admin");

  // Legacy hook: anything dispatching "open-chat" now lands on the agent page.
  useEffect(() => {
    const handler = () => router.push("/");
    window.addEventListener("open-chat", handler);
    return () => window.removeEventListener("open-chat", handler);
  }, [router]);

  if (isLoginPage || isReferrerRoute) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen page-texture">
      <Sidebar
        onToggleChat={() => router.push("/")}
        isChatOpen={pathname === "/"}
      />
      <MobileNav
        onToggleChat={() => router.push("/")}
        isChatOpen={pathname === "/"}
      />

      {/* Page content */}
      <main className="min-h-screen md:ml-[220px]">{children}</main>

      {/* Per-page help → Notion SOP */}
      <HelpButton />

      {/* App-wide toasts (success/error feedback on mutating actions) */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#fff",
            border: "1px solid #e8e8ed",
            color: "#2d2a33",
            borderRadius: "0.75rem",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.03)",
          },
        }}
      />
    </div>
  );
}
