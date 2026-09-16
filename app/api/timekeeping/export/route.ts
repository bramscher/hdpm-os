import { context, exportRows, payrollSource } from "@/lib/timekeeping/server";
import {
  payrollWorkbook,
  type PayrollSnapshot,
} from "@/lib/timekeeping/export";
import { failure } from "@/lib/timekeeping/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const ctx = await context();
    const review = params.get("review") === "1";
    let snapshot: PayrollSnapshot;
    if (review) {
      snapshot = {
        ...(await payrollSource(ctx, params.get("period") || "")),
        generatedAt: new Date().toISOString(),
        createdBy: ctx.email,
        version: 0,
      };
    } else {
      const id = params.get("id");
      if (!id) throw new Error("Choose a saved payroll export.");
      snapshot = (await exportRows(ctx, id)).snapshot as PayrollSnapshot;
    }
    return new Response(new Uint8Array(payrollWorkbook(snapshot, { review })), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="HDPM_Payroll_${snapshot.periodStart}_to_${snapshot.periodEnd}_${review ? "REVIEW" : `v${snapshot.version}`}.xlsx"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
