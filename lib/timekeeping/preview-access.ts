import { requireCompanySession } from "@/lib/require-role";
import { getSupabaseAdmin } from "@/lib/supabase";

/** Invited staff can test fictional data without payroll or administrator access. */
const PREVIEW_PILOTS = new Set(["Brody"]);

export async function canUseEmployeePreview(): Promise<boolean> {
  const guard = await requireCompanySession();
  if (!guard.ok) return false;
  if (guard.role === "admin") return true;
  const { data, error } = await getSupabaseAdmin()
    .from("staff")
    .select("person")
    .ilike("email", guard.email)
    .eq("active", true)
    .limit(2);
  return !error && data?.length === 1 && PREVIEW_PILOTS.has(data[0].person);
}
