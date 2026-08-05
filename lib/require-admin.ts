/**
 * Server-side admin guard for API routes. The middleware already gates the
 * financial dashboards, but the most sensitive routes (config writes, financials)
 * call this too for defense-in-depth — never trust a single layer for money data.
 *
 * Usage:
 *   const guard = await requireAdmin();
 *   if (!guard.ok) return guard.response;
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";

type AdminGuard =
  | { ok: true; email: string }
  | { ok: false; response: NextResponse };

export async function requireAdmin(): Promise<AdminGuard> {
  const guard = await requireRole("admin");
  if (!guard.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      ),
    };
  }
  return { ok: true, email: guard.email };
}
