import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InspectionDashboard } from "./inspection-dashboard";

export default async function InspectionsPage() {
  const session = await auth();

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <InspectionDashboard />
      </div>
    </main>
  );
}
