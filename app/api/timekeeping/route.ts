import { NextResponse } from "next/server";
import {
  bootstrap,
  command,
  context,
  exportRows,
  history,
  listSheets,
  TimeError,
} from "@/lib/timekeeping/server";
import { failure } from "@/lib/timekeeping/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await context(),
      url = new URL(request.url),
      view = url.searchParams.get("view");
    const data =
      view === "review"
        ? await listSheets(ctx, url.searchParams.get("period") || undefined)
        : view === "history"
          ? await history(ctx, url.searchParams.get("id") || "")
          : view === "exports"
            ? await exportRows(ctx)
            : await bootstrap(ctx);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new TimeError("Request origin does not match.", 403);
    const raw = await request.text();
    if (raw.length > 250000)
      throw new TimeError("Timesheet is too large.", 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new TimeError("Invalid request.");
    return NextResponse.json(await command(await context(), body), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
