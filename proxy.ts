/**
 * Route protection (Phase 0, Brief B — Next 16 proxy convention, replacing
 * the deprecated middleware.ts + next-auth/middleware withAuth).
 *
 * Deliberately does NOT import lib/auth.ts: this runs on the edge runtime,
 * and the auth config pulls Node-only deps (Supabase role lookup). Instead
 * it decodes the Auth.js session cookie directly via next-auth/jwt getToken
 * and enforces the same two rules as before:
 *   1. everything requires a session except the self-guarded public prefixes;
 *   2. the financial dashboards/APIs require the admin role.
 */

import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_SECRET = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";

// Routes reachable without a user session (protected by their own secrets, or public).
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/api/sync",
  "/api/webhooks",
  "/api/kpi/cron", // Vercel cron — protected by CRON_SECRET, not session auth
  "/api/maintenance/cron", // Vercel cron — protected by CRON_SECRET, not session auth
  "/api/agents", // Agent layer — self-guarded via HDPM_SERVICE_TOKEN or staff session (requireStaffOrService)
  "/api/intake", // hdpm-web rental-analysis handoff — self-guarded via HDPM_SERVICE_TOKEN
];

// Admin-only: the entire KPI/financial dashboard and its data APIs.
// (/api/kpi/cron is deliberately excluded — it has no user session.)
function isAdminPath(pathname: string): boolean {
  if (pathname === "/api/kpi/cron") return false;
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/kpi") ||
    pathname.startsWith("/api/config") ||
    pathname.startsWith("/api/financials") ||
    pathname.startsWith("/api/zoom-sync")
  );
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = await getToken({
    req,
    secret: AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  });

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    // Unauthenticated page hit → sign-in, preserving the destination.
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `callbackUrl=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  // Admin gating for financial dashboards (role claim from staff.access_role;
  // isAdmin kept for tokens minted before the role claim existed).
  if (isAdminPath(pathname) && token.role !== "admin" && token.isAdmin !== true) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    // Non-admin hitting an admin page → send to the home dashboard.
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Protect all routes except static files and Next.js internals
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)",
  ],
};
