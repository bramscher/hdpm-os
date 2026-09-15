import { employees, ensureSheets } from "@/lib/timekeeping/server";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET
    ? Buffer.from(`Bearer ${process.env.CRON_SECRET}`)
    : null;
  const received = Buffer.from(request.headers.get("authorization") || "");
  if (
    !expected ||
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    for (const e of await employees()) await ensureSheets(e);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Timekeeping period generation failed" },
      { status: 500 },
    );
  }
}
