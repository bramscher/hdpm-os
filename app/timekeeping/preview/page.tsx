import { notFound } from "next/navigation";
import { canUseEmployeePreview } from "@/lib/timekeeping/preview-access";
import EmployeePreview from "./preview";
import "../timekeeping.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Employee preview — Timekeeping",
  robots: { index: false, follow: false },
};
export default async function Page() {
  if (!(await canUseEmployeePreview())) notFound();
  return <EmployeePreview />;
}
