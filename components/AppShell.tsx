"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import { Sidebar, MobileNav } from "@/components/Sidebar";
import { HelpButton } from "@/components/HelpButton";

/**
 * App chrome: fixed sidebar + page content. The in-app Knowledge Chat has been
 * retired — that role now lives in Dez (Slack) — and `/` is the tile dashboard.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  // Referrer portal opts out of the staff chrome (sidebar/help/nav). The admin
  // subtree keeps the staff shell. Referrer pages bring their own layout.
  const isReferrerRoute =
    pathname.startsWith("/partners") && !pathname.startsWith("/partners/admin");

  if (isLoginPage || isReferrerRoute) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen page-texture">
      <Sidebar />
      <MobileNav />

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
