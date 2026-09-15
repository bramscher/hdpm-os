import { NextResponse } from "next/server";
import { TimeError } from "./server";
export function failure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Timekeeping request failed",
    },
    {
      status: error instanceof TimeError ? error.status : 400,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
