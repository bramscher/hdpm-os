import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Routes reachable without a user session (protected by their own secrets, or public).
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/api/sync",
  "/api/webhooks",
  "/api/inspections/notify",
  "/api/kpi/cron", // Vercel cron — protected by CRON_SECRET, not session auth
];

// Admin-only: the entire KPI/financial dashboard and its data APIs.
// (/api/kpi/cron is deliberately excluded — it has no user session.)
function isAdminPath(pathname: string): boolean {
  if (pathname === "/api/kpi/cron") return false;
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname.startsWith("/api/kpi") ||
    pathname.startsWith("/api/config") ||
    pathname.startsWith("/api/financials")
  );
}

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Admin gating for financial dashboards.
    if (isAdminPath(pathname) && token?.isAdmin !== true) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
      // Non-admin hitting an admin page → send to the home dashboard.
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;
        if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
          return true;
        }
        // Require authentication for all other routes
        return !!token;
      },
    },
  }
);

export const config = {
  // Protect all routes except static files and Next.js internals
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)",
  ],
};
