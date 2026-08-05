import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OwnerReportDashboard } from "./owner-report-dashboard";

export default async function OwnerReportPage() {
  const session = await auth();

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <OwnerReportDashboard />
      </div>
    </main>
  );
}
