import { notFound } from "next/navigation";
import { requireRole } from "@/lib/require-role";
import EmployeePreview from "./preview";
import "../timekeeping.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Employee preview — Timekeeping",
  robots: { index: false, follow: false },
};
export default async function Page() {
  const guard = await requireRole("admin");
  if (!guard.ok) notFound();
  return <EmployeePreview />;
}
