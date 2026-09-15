import { context, exportRows } from "@/lib/timekeeping/server";
import {
  payrollWorkbook,
  type PayrollSnapshot,
} from "@/lib/timekeeping/export";
import { failure } from "@/lib/timekeeping/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Choose a saved payroll export.");
    const row = await exportRows(await context(), id);
    const snapshot = row.snapshot as PayrollSnapshot;
    return new Response(new Uint8Array(payrollWorkbook(snapshot)), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="HDPM_Payroll_${snapshot.periodStart}_to_${snapshot.periodEnd}_v${snapshot.version}.xlsx"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
